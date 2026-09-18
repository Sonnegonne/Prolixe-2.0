// server/src/controllers/SchoolController.js
//
// Une enseignante peut travailler dans plusieurs etablissements. L'ecole est
// la racine du cloisonnement : un journal appartient a une ecole, et tout ce
// qui pend au journal (classes, eleves, evaluations, horaires) suit.
//
// Deux choix structurants, faits une fois pour toutes :
//
//  1. `JOURNALS.school_id` est *nullable* en base, mais la migration le
//     remplit pour tout l'existant. Le NULL ne subsiste que le temps d'un
//     deploiement ou pour un journal cree par un client qui ignore les ecoles.
//  2. La grille horaire (`SCH_HOURS`) reste partagee par defaut
//     (`school_id IS NULL`) : les deux etablissements de l'utilisatrice
//     historique lisent la meme, personne ne voit rien changer. Une ecole
//     n'obtient sa grille propre que si on la lui detache explicitement
//     (voir ScheduleHoursController.detach), ce qui evite de remapper des
//     centaines de SCHEDULE_SLOTS a l'aveugle.
const pool = require('../../config/database');

// Palette lisible en clair comme en sombre, assez contrastee pour servir de
// pastille d'ecole a cote des couleurs de matieres.
const SCHOOL_COLORS = ['#2563eb', '#db2777', '#0d9488', '#d97706', '#7c3aed', '#be123c'];

class SchoolController {

    // =====================================================================
    // --- MIGRATION (appelee au boot, cf. server.js) ---
    // =====================================================================

    static async hasColumn(connection, table, column) {
        const [rows] = await connection.execute(`
            SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
        `, [table, column]);
        return rows.length > 0;
    }

    static async migrate(connection) {
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS SCHOOLS (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                name VARCHAR(150) NOT NULL,
                short_name VARCHAR(16) NOT NULL DEFAULT '',
                color VARCHAR(7) NOT NULL DEFAULT '#2563eb',
                display_order INT NOT NULL DEFAULT 0,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_school (user_id, name)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        // MySQL ne connait pas ADD COLUMN IF NOT EXISTS : on regarde d'abord.
        for (const [table, column, definition] of [
            ['JOURNALS', 'school_id', 'INT NULL DEFAULT NULL'],
            ['SCH_HOURS', 'school_id', 'INT NULL DEFAULT NULL'],
            ['ATTRIBUTIONS', 'school_id', 'INT NULL DEFAULT NULL'],
        ]) {
            if (await SchoolController.hasColumn(connection, table, column)) continue;
            await connection.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
            console.log(`   ↳ colonne ${table}.${column} ajoutée`);
        }

        await SchoolController.backfill(connection);
    }

    // Chaque utilisateur qui a deja des journaux recoit son ecole d'origine.
    // Son nom vient des attributions (« ISLW » pour le compte historique), ce
    // qui evite de lui faire renommer une « Mon école » generique.
    static async backfill(connection) {
        const [users] = await connection.execute(`
            SELECT DISTINCT j.user_id
            FROM JOURNALS j
            LEFT JOIN SCHOOLS s ON s.user_id = j.user_id
            WHERE j.school_id IS NULL AND s.id IS NULL
        `);

        for (const { user_id: userId } of users) {
            const [attributions] = await connection.execute(`
                SELECT school_name, COUNT(*) AS n
                FROM ATTRIBUTIONS
                WHERE user_id = ? AND school_name IS NOT NULL AND school_name <> ''
                GROUP BY school_name
                ORDER BY n DESC
                LIMIT 1
            `, [userId]);

            const name = (attributions[0] && attributions[0].school_name) || 'Mon école';
            const [result] = await connection.execute(
                'INSERT INTO SCHOOLS (user_id, name, short_name, color, display_order) VALUES (?, ?, ?, ?, 0)',
                [userId, name, SchoolController.deriveShortName(name), SCHOOL_COLORS[0]]
            );

            await connection.execute(
                'UPDATE JOURNALS SET school_id = ? WHERE user_id = ? AND school_id IS NULL',
                [result.insertId, userId]
            );
            await connection.execute(
                'UPDATE ATTRIBUTIONS SET school_id = ? WHERE user_id = ? AND school_id IS NULL AND school_name = ?',
                [result.insertId, userId, name]
            );
            console.log(`   ↳ école « ${name} » créée pour l'utilisateur ${userId}`);
        }

        // Journaux crees entre-temps (ou ecole deja presente mais journal neuf)
        // : on les rattache a la premiere ecole de leur proprietaire.
        await connection.execute(`
            UPDATE JOURNALS j
            JOIN (
                SELECT user_id, MIN(id) AS school_id FROM SCHOOLS GROUP BY user_id
            ) s ON s.user_id = j.user_id
            SET j.school_id = s.school_id
            WHERE j.school_id IS NULL
        `);
    }

    // « Institut Saint-Laurent » -> « ISL », « ISLW » -> « ISLW ».
    static deriveShortName(name) {
        const clean = String(name || '').trim();
        if (!clean) return '?';
        if (clean.length <= 5) return clean.toUpperCase();
        const initials = clean
            .split(/[\s'’\-_]+/)
            .filter(word => word.length > 2 || /^[A-Z]/.test(word))
            .map(word => word[0])
            .join('')
            .toUpperCase();
        return (initials.length >= 2 ? initials : clean.toUpperCase()).slice(0, 5);
    }

    // =====================================================================
    // --- HELPERS PARTAGES ---
    // =====================================================================

    // Toute route qui accepte un school_id passe par ici : sans cette
    // verification, un id devine donnerait acces aux journaux d'un collegue.
    static async assertOwned(executor, schoolId, userId) {
        const [rows] = await executor.execute(
            'SELECT * FROM SCHOOLS WHERE id = ? AND user_id = ?',
            [schoolId, userId]
        );
        if (rows.length === 0) {
            throw Object.assign(new Error('École introuvable.'), { status: 404 });
        }
        return rows[0];
    }

    static async listForUser(executor, userId) {
        const [rows] = await executor.execute(
            'SELECT * FROM SCHOOLS WHERE user_id = ? ORDER BY display_order ASC, id ASC',
            [userId]
        );
        return rows;
    }

    static handleError(res, error, message) {
        const status = error.status || 500;
        if (status === 500) console.error(`❌ ${message}:`, error);
        res.status(status).json({ success: false, message: error.status ? error.message : message });
    }

    // =====================================================================
    // --- CRUD ---
    // =====================================================================

    static async list(req, res) {
        try {
            const schools = await SchoolController.listForUser(pool, req.user.id);
            // Le compteur sert a l'ecran de gestion : on ne propose la
            // suppression que d'une ecole qui n'emporterait rien avec elle.
            const [counts] = await pool.execute(`
                SELECT school_id, COUNT(*) AS journals_count
                FROM JOURNALS WHERE user_id = ? GROUP BY school_id
            `, [req.user.id]);
            const byId = new Map(counts.map(c => [c.school_id, c.journals_count]));

            res.json({
                success: true,
                data: schools.map(s => ({ ...s, journals_count: byId.get(s.id) || 0 }))
            });
        } catch (error) {
            SchoolController.handleError(res, error, 'Erreur récupération des écoles.');
        }
    }

    static async create(req, res) {
        const userId = req.user.id;
        const name = String(req.body.name || '').trim();
        if (!name) {
            return res.status(400).json({ success: false, message: "Le nom de l'école est requis." });
        }

        try {
            const existing = await SchoolController.listForUser(pool, userId);
            if (existing.some(s => s.name.toLowerCase() === name.toLowerCase())) {
                return res.status(409).json({ success: false, message: 'Une école porte déjà ce nom.' });
            }

            const color = req.body.color || SCHOOL_COLORS[existing.length % SCHOOL_COLORS.length];
            const shortName = String(req.body.short_name || '').trim() || SchoolController.deriveShortName(name);

            const [result] = await pool.execute(
                'INSERT INTO SCHOOLS (user_id, name, short_name, color, display_order) VALUES (?, ?, ?, ?, ?)',
                [userId, name, shortName.slice(0, 16), color, existing.length]
            );

            // Une ecole neuve part avec sa grille horaire propre, copiee de la
            // grille commune. Sans cela, elle lirait celle de l'ecole
            // historique et le premier import de PDF y deverserait ses propres
            // creneaux — au vu et au su de l'autre etablissement. La copie est
            // sans risque ici : l'ecole n'a encore aucun cours place.
            await pool.execute(`
                INSERT INTO SCH_HOURS (libelle, school_id)
                SELECT libelle, ? FROM SCH_HOURS WHERE school_id IS NULL
            `, [result.insertId]);

            res.status(201).json({ success: true, data: { id: result.insertId, name, short_name: shortName, color } });
        } catch (error) {
            SchoolController.handleError(res, error, "Erreur création de l'école.");
        }
    }

    static async update(req, res) {
        const { id } = req.params;
        try {
            const school = await SchoolController.assertOwned(pool, id, req.user.id);

            const name = req.body.name !== undefined ? String(req.body.name).trim() : school.name;
            if (!name) {
                return res.status(400).json({ success: false, message: "Le nom de l'école est requis." });
            }
            const shortName = req.body.short_name !== undefined
                ? String(req.body.short_name).trim() || SchoolController.deriveShortName(name)
                : school.short_name;
            const color = req.body.color || school.color;
            const order = req.body.display_order !== undefined ? parseInt(req.body.display_order, 10) : school.display_order;

            await pool.execute(
                'UPDATE SCHOOLS SET name = ?, short_name = ?, color = ?, display_order = ? WHERE id = ? AND user_id = ?',
                [name, shortName.slice(0, 16), color, Number.isFinite(order) ? order : school.display_order, id, req.user.id]
            );
            res.json({ success: true, data: { ...school, name, short_name: shortName, color } });
        } catch (error) {
            SchoolController.handleError(res, error, "Erreur mise à jour de l'école.");
        }
    }

    // Suppression volontairement stricte : l'ecole ne part que vide. Detruire
    // en cascade effacerait des annees de journal sur un clic.
    static async remove(req, res) {
        const { id } = req.params;
        let connection;
        try {
            connection = await pool.getConnection();
            await connection.beginTransaction();
            await SchoolController.assertOwned(connection, id, req.user.id);

            const [[{ n: journals }]] = await connection.execute(
                'SELECT COUNT(*) AS n FROM JOURNALS WHERE school_id = ?', [id]
            );
            if (journals > 0) {
                await connection.rollback();
                return res.status(409).json({
                    success: false,
                    message: `Cette école porte encore ${journals} journal(aux). Supprimez-les d'abord.`
                });
            }

            await connection.execute('DELETE FROM SCH_HOURS WHERE school_id = ?', [id]);
            await connection.execute('UPDATE ATTRIBUTIONS SET school_id = NULL WHERE school_id = ?', [id]);
            await connection.execute('DELETE FROM SCHOOLS WHERE id = ? AND user_id = ?', [id, req.user.id]);

            await connection.commit();
            res.json({ success: true, message: 'École supprimée.' });
        } catch (error) {
            if (connection) await connection.rollback();
            SchoolController.handleError(res, error, "Erreur suppression de l'école.");
        } finally {
            if (connection) connection.release();
        }
    }
}

module.exports = SchoolController;
module.exports.SCHOOL_COLORS = SCHOOL_COLORS;
