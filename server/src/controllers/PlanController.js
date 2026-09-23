// server/src/controllers/PlanController.js
//
// Plans de classe : une disposition par classe, rangée en base pour que
// l'enseignante retrouve la même salle d'un poste à l'autre.
//
// La disposition est un document JSON que seul le client interprète (îlots,
// bancs, couleurs) : le serveur ne fait que la garder et vérifier qu'elle a la
// bonne forme. Chaque enregistrement incrémente `version` ; le client renvoie
// la version sur laquelle il a travaillé, et une version dépassée est refusée
// (409) plutôt que d'écraser ce qu'un autre poste vient d'enregistrer.

const pool = require('../../config/database');

// Une salle réelle tient en quelques kilo-octets ; la borne évite qu'un client
// défaillant remplisse la table.
const MAX_LAYOUT_BYTES = 64 * 1024;

class PlanController {

    static async withConnection(operation) {
        let connection;
        try {
            connection = await pool.getConnection();
            return await operation(connection);
        } catch (error) {
            console.error('Erreur SQL (PlanController):', error.message);
            throw error;
        } finally {
            if (connection) connection.release();
        }
    }

    static handleError(res, error, defaultMessage = 'Erreur serveur') {
        const status = error.status || 500;
        console.error(`❌ ${defaultMessage}:`, error);
        res.status(status).json({
            success: false,
            message: error.status ? error.message : defaultMessage,
            error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        });
    }

    /** Appelée au démarrage (server.js) : le projet n'a pas d'outil de migration. */
    static async migrate(connection) {
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS CLASS_PLANS (
                class_id INT NOT NULL PRIMARY KEY,
                layout MEDIUMTEXT NOT NULL,
                version INT NOT NULL DEFAULT 1,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                    ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    }

    /** La classe doit appartenir à un journal de l'utilisateur connecté. */
    static async assertOwnsClass(db, classId, userId) {
        const [rows] = await db.execute(`
            SELECT c.id FROM CLASSES c
            INNER JOIN JOURNALS j ON c.journal_id = j.id
            WHERE c.id = ? AND j.user_id = ?
        `, [classId, userId]);
        if (rows.length === 0) {
            const error = new Error('Classe introuvable ou accès refusé.');
            error.status = 403;
            throw error;
        }
    }

    static parseClassId(raw) {
        const id = Number.parseInt(raw, 10);
        if (!Number.isFinite(id) || id <= 0) {
            const error = new Error('Identifiant de classe invalide.');
            error.status = 400;
            throw error;
        }
        return id;
    }

    static rowToPlan(row) {
        let layout = null;
        try {
            layout = JSON.parse(row.layout);
        } catch (err) {
            // Une ligne illisible se comporte comme une salle jamais créée.
        }
        return { layout, version: row.version, updated_at: row.updated_at };
    }

    // Vérification de forme, pas de sens : assez pour ne jamais renvoyer au
    // client un document qui le ferait planter.
    static isValidLayout(layout) {
        return Boolean(
            layout
            && typeof layout === 'object'
            && Array.isArray(layout.blocks)
            && layout.blocks.length > 0
            && layout.blocks.every(b =>
                b && Number.isInteger(b.rows) && Number.isInteger(b.cols)
                && Array.isArray(b.seats) && b.seats.length === b.rows * b.cols
            )
        );
    }

    /** GET /plans/:classId — `data` vaut null si la classe n'a pas encore de plan. */
    static async getPlan(req, res) {
        try {
            const classId = PlanController.parseClassId(req.params.classId);
            const plan = await PlanController.withConnection(async (db) => {
                await PlanController.assertOwnsClass(db, classId, req.user.id);
                const [rows] = await db.execute(
                    'SELECT layout, version, updated_at FROM CLASS_PLANS WHERE class_id = ?',
                    [classId]
                );
                return rows.length ? PlanController.rowToPlan(rows[0]) : null;
            });
            res.json({ success: true, data: plan });
        } catch (error) {
            PlanController.handleError(res, error, 'Erreur de chargement du plan de classe.');
        }
    }

    /**
     * PUT /plans/:classId — body { layout, version }.
     * `version` est celle que le client a chargée (0 ou absente : aucun plan).
     * Si le plan a bougé entre-temps, 409 avec la version en base.
     */
    static async savePlan(req, res) {
        try {
            const classId = PlanController.parseClassId(req.params.classId);
            const { layout } = req.body || {};
            const baseVersion = Number.parseInt(req.body?.version, 10) || 0;

            if (!PlanController.isValidLayout(layout)) {
                const error = new Error('Disposition invalide.');
                error.status = 400;
                throw error;
            }
            const json = JSON.stringify(layout);
            if (Buffer.byteLength(json, 'utf8') > MAX_LAYOUT_BYTES) {
                const error = new Error('Disposition trop volumineuse.');
                error.status = 413;
                throw error;
            }

            const outcome = await PlanController.withConnection(async (db) => {
                await PlanController.assertOwnsClass(db, classId, req.user.id);

                let affected;
                if (baseVersion === 0) {
                    // Premier enregistrement : un autre poste a pu nous devancer,
                    // l'INSERT IGNORE ne touche alors à rien et on le signale.
                    const [result] = await db.execute(
                        'INSERT IGNORE INTO CLASS_PLANS (class_id, layout, version) VALUES (?, ?, 1)',
                        [classId, json]
                    );
                    affected = result.affectedRows;
                } else {
                    const [result] = await db.execute(
                        'UPDATE CLASS_PLANS SET layout = ?, version = version + 1 WHERE class_id = ? AND version = ?',
                        [json, classId, baseVersion]
                    );
                    affected = result.affectedRows;
                }

                const [rows] = await db.execute(
                    'SELECT layout, version, updated_at FROM CLASS_PLANS WHERE class_id = ?',
                    [classId]
                );
                const current = rows.length ? PlanController.rowToPlan(rows[0]) : null;
                return { conflict: affected === 0, current };
            });

            if (outcome.conflict) {
                return res.status(409).json({
                    success: false,
                    message: 'Le plan a été modifié depuis un autre poste.',
                    data: outcome.current,
                });
            }
            res.json({
                success: true,
                data: { version: outcome.current.version, updated_at: outcome.current.updated_at },
            });
        } catch (error) {
            PlanController.handleError(res, error, "Erreur d'enregistrement du plan de classe.");
        }
    }
}

module.exports = PlanController;
