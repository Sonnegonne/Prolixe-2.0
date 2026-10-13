// server/src/controllers/SmartschoolController.js
//
// Pont entre le journal de classe et les actualités de cours Smartschool.
//
// Le modèle est volontairement « une actualité par cours, tenue à jour » et non
// « une actualité par entrée » : les élèves ont une page unique à consulter, et
// surtout la publication devient idempotente. C'est l'empreinte du contenu
// (`published_hash`) qui décide s'il faut réécrire quoi que ce soit — jamais un
// horodatage, sinon chaque sondage de l'extension republierait à l'identique.
//
// Rien ici ne parle à Smartschool : le serveur n'a aucune session d'enseignante.
// Il prépare le contenu, l'extension Chrome le pose depuis le navigateur.

const pool = require('../../config/database');
const {
    buildRows, renderHtml, renderText, contentHash,
    notifiableKeys, newKeys, parseKeys,
    todayKey, isInReminderWindow, buildReminder, hiddenHash, toDateKey,
    REMINDER_TYPES,
} = require('../services/smartschoolJournal');

class SmartschoolController {

    // =========================================================
    // --- UTILITAIRES ---
    // =========================================================

    static async withConnection(operation) {
        let connection;
        try {
            connection = await pool.getConnection();
            return await operation(connection);
        } catch (error) {
            console.error('Erreur SQL (SmartschoolController):', error.message);
            throw error;
        } finally {
            if (connection) connection.release();
        }
    }

    static handleError(res, error, defaultMessage = 'Erreur serveur', statusCode = 500) {
        console.error(`❌ ${defaultMessage}:`, error);
        res.status(statusCode).json({
            success: false,
            message: defaultMessage,
            error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        });
    }

    /**
     * Crée la table de liaison et les colonnes d'exclusion si elles manquent.
     * Appelée au démarrage (server.js), dans l'esprit des `CREATE TABLE IF NOT
     * EXISTS` déjà présents : ce projet n'a pas d'outil de migration.
     */
    static async migrate(connection) {
        // La clé métier est le **cours**, c'est-à-dire classe × matière, et non
        // la classe : une même classe peut suivre deux cours distincts chez la
        // même enseignante (3 TIN a « Informatique » et « Exploitation
        // logiciels »), qui correspondent à deux cours Smartschool séparés.
        // Les confondre publiait les deux matières dans un seul tableau.
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS SMARTSCHOOL_TARGETS (
                id INT AUTO_INCREMENT PRIMARY KEY,
                journal_id INT NOT NULL,
                class_id INT NOT NULL,
                subject_id INT NOT NULL DEFAULT 0,
                course_id VARCHAR(32) NOT NULL,
                ss_id VARCHAR(32) NOT NULL,
                news_id VARCHAR(32) DEFAULT NULL,
                title VARCHAR(255) NOT NULL DEFAULT 'Journal de classe',
                is_enabled TINYINT(1) NOT NULL DEFAULT 1,
                published_hash CHAR(64) DEFAULT NULL,
                published_at DATETIME DEFAULT NULL,
                last_error TEXT DEFAULT NULL,
                last_error_at DATETIME DEFAULT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_target (journal_id, class_id, subject_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await SmartschoolController.migrateToSubjectKey(connection);

        // Les assignations (interros et prépas) présentes dans la dernière
        // publication : c'est la seule façon de savoir qu'une interro vient
        // d'apparaître, et donc qu'il faut prévenir les élèves. NULL = inconnu.
        const [colAssign] = await connection.execute(`
            SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'SMARTSCHOOL_TARGETS' AND COLUMN_NAME = 'published_assignments'
        `);
        if (colAssign.length === 0) {
            await connection.query(
                'ALTER TABLE SMARTSCHOOL_TARGETS ADD COLUMN published_assignments TEXT DEFAULT NULL'
            );
            console.log('   ↳ colonne SMARTSCHOOL_TARGETS.published_assignments ajoutée');
        }

        // Une actualité de rappel par interro, visible de J-2 à J. `visible`
        // dit ce qui est réellement en ligne ; `title` et `html` sont gardés
        // pour pouvoir retirer le rappel d'une interro supprimée entre-temps.
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS SMARTSCHOOL_REMINDERS (
                id INT AUTO_INCREMENT PRIMARY KEY,
                target_id INT NOT NULL,
                assignment_id INT NOT NULL,
                news_id VARCHAR(32) DEFAULT NULL,
                due_date DATE DEFAULT NULL,
                title VARCHAR(255) DEFAULT NULL,
                html TEXT DEFAULT NULL,
                visible TINYINT(1) NOT NULL DEFAULT 0,
                published_hash CHAR(64) DEFAULT NULL,
                published_at DATETIME DEFAULT NULL,
                last_error TEXT DEFAULT NULL,
                last_error_at DATETIME DEFAULT NULL,
                UNIQUE KEY uniq_reminder (target_id, assignment_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        // MySQL ne connaît pas ADD COLUMN IF NOT EXISTS : on regarde d'abord.
        for (const [table, column] of [
            ['JOURNAL_ENTRIES', 'exclude_from_smartschool'],
            ['ASSIGNMENTS', 'exclude_from_smartschool'],
        ]) {
            const [found] = await connection.execute(`
                SELECT 1 FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
            `, [table, column]);

            if (found.length === 0) {
                await connection.query(
                    `ALTER TABLE ${table} ADD COLUMN ${column} TINYINT(1) NOT NULL DEFAULT 0`
                );
                console.log(`   ↳ colonne ${table}.${column} ajoutée`);
            }
        }

        await SmartschoolController.migrateDevoirCote(connection);
    }

    /**
     * Ajoute « Devoir coté » à l'ENUM de ASSIGNMENTS.type (13 octobre 2026).
     * La liste existante est relue puis complétée, jamais réécrite de mémoire :
     * une valeur oubliée ici rendrait illisibles les lignes qui la portent.
     */
    static async migrateDevoirCote(connection) {
        const [cols] = await connection.execute(`
            SELECT COLUMN_TYPE, COLUMN_DEFAULT, IS_NULLABLE FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ASSIGNMENTS' AND COLUMN_NAME = 'type'
        `);
        if (cols.length === 0) return;
        const { COLUMN_TYPE: columnType, COLUMN_DEFAULT: defaut, IS_NULLABLE: nullable } = cols[0];
        if (!/^enum\(/i.test(columnType) || columnType.includes("'Devoir coté'")) return;

        const valeurs = [...columnType.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
        const i = valeurs.indexOf('Devoir');
        valeurs.splice(i >= 0 ? i + 1 : valeurs.length, 0, 'Devoir coté');

        const liste = valeurs.map((v) => connection.escape(v)).join(', ');
        const clauseDefaut = defaut != null
            ? ` DEFAULT ${connection.escape(String(defaut).replace(/^'|'$/g, ''))}`
            : '';
        await connection.query(
            `ALTER TABLE ASSIGNMENTS MODIFY COLUMN type ENUM(${liste})`
            + `${nullable === 'YES' ? ' NULL' : ' NOT NULL'}${clauseDefaut}`
        );
        console.log('   ↳ type « Devoir coté » ajouté à ASSIGNMENTS.type');
    }

    /**
     * Fait passer une table créée avant le 13 septembre 2026 — dont la clé
     * était (journal, classe) — à la clé (journal, classe, matière).
     *
     * Idempotente : elle regarde l'état réel dans `information_schema` plutôt
     * que de supposer, parce qu'elle tourne à chaque démarrage.
     */
    static async migrateToSubjectKey(connection) {
        const [colonne] = await connection.execute(`
            SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'SMARTSCHOOL_TARGETS' AND COLUMN_NAME = 'subject_id'
        `);
        if (colonne.length === 0) {
            await connection.query(
                'ALTER TABLE SMARTSCHOOL_TARGETS ADD COLUMN subject_id INT NOT NULL DEFAULT 0 AFTER class_id'
            );
            console.log('   ↳ colonne SMARTSCHOOL_TARGETS.subject_id ajoutée');
        }

        // Les liaisons déjà posées ne nomment aucune matière. Quand la classe
        // n'en suit qu'une, il n'y a pas d'ambiguïté et on la renseigne ; quand
        // elle en suit deux, seule l'enseignante peut trancher — la liaison
        // reste à 0 et l'interface la montre comme « à refaire ».
        const [orphelines] = await connection.execute(
            'SELECT id, journal_id, class_id FROM SMARTSCHOOL_TARGETS WHERE subject_id = 0'
        );
        for (const cible of orphelines) {
            const [matieres] = await connection.execute(`
                SELECT DISTINCT ss.subject_id
                FROM SCHEDULE_SLOTS ss
                WHERE ss.class_id = ? AND ss.subject_id IS NOT NULL
            `, [cible.class_id]);

            if (matieres.length === 1) {
                await connection.execute(
                    'UPDATE SMARTSCHOOL_TARGETS SET subject_id = ? WHERE id = ?',
                    [matieres[0].subject_id, cible.id]
                );
                console.log(`   ↳ liaison ${cible.id} rattachée à la matière ${matieres[0].subject_id}`);
            }
        }

        // L'ancienne clé unique à deux colonnes interdirait le second cours.
        const [index] = await connection.execute(`
            SELECT COUNT(*) AS colonnes FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'SMARTSCHOOL_TARGETS' AND INDEX_NAME = 'uniq_target'
        `);
        if (Number(index[0]?.colonnes) === 2) {
            await connection.query('ALTER TABLE SMARTSCHOOL_TARGETS DROP INDEX uniq_target');
            await connection.query(
                'ALTER TABLE SMARTSCHOOL_TARGETS ADD UNIQUE KEY uniq_target (journal_id, class_id, subject_id)'
            );
            console.log('   ↳ clé unique élargie à la matière');
        }
    }

    /** Vérifie que le journal appartient bien à l'utilisateur connecté. */
    static async assertOwnsJournal(db, journalId, userId) {
        const [rows] = await db.execute(
            'SELECT id FROM JOURNALS WHERE id = ? AND user_id = ?',
            [journalId, userId]
        );
        if (rows.length === 0) {
            const error = new Error('Journal introuvable ou accès refusé.');
            error.status = 403;
            throw error;
        }
    }

    /**
     * Rassemble le contenu publiable d'un cours : lignes, HTML, texte, empreinte.
     * Les entrées sont rattachées à la classe par leur créneau d'horaire — il
     * n'y a pas de class_id sur JOURNAL_ENTRIES.
     */
    static async buildContent(db, target) {
        const [entries] = await db.execute(`
            SELECT je.entry_date, je.content_done, je.exclude_from_smartschool
            FROM JOURNAL_ENTRIES je
            JOIN SCHEDULE_SLOTS ss ON je.schedule_slot_id = ss.id
            WHERE je.journal_id = ? AND ss.class_id = ? AND ss.subject_id = ?
            ORDER BY je.entry_date ASC
        `, [target.journal_id, target.class_id, target.subject_id]);

        // Une assignation appartient à la matière de son créneau. Celles qui
        // n'en ont aucun — il n'y en a pas aujourd'hui, mais rien ne l'empêche —
        // sont rattachées à tous les cours de la classe : mieux vaut une ligne
        // en double qu'un devoir qui disparaît sans que personne le voie.
        const [assignments] = await db.execute(`
            SELECT a.id, a.due_date, a.type, a.subject, a.description, a.exclude_from_smartschool
            FROM ASSIGNMENTS a
            LEFT JOIN SCHEDULE_SLOTS ss ON a.schedule_slot_id = ss.id
            WHERE a.journal_id = ? AND a.class_id = ?
              AND (ss.subject_id = ? OR a.schedule_slot_id IS NULL)
            ORDER BY a.due_date ASC
        `, [target.journal_id, target.class_id, target.subject_id]);

        const rows = buildRows(entries, assignments);
        const updatedAt = new Date();

        return {
            rows,
            assignments,
            assignmentKeys: notifiableKeys(assignments),
            html: renderHtml(rows, { updatedAt }),
            text: renderText(rows, { updatedAt }),
            hash: contentHash(target.title, rows),
        };
    }

    /** Les cours reliés de l'utilisateur, avec classe et matière. */
    static async listTargets(db, userId, { journalId = null, enabledOnly = false } = {}) {
        const params = [userId];
        let sql = `
            SELECT t.*, c.name AS class_name, s.name AS subject_name, j.name AS journal_name
            FROM SMARTSCHOOL_TARGETS t
            JOIN JOURNALS j ON t.journal_id = j.id
            JOIN CLASSES c ON t.class_id = c.id
            LEFT JOIN SUBJECTS s ON t.subject_id = s.id
            WHERE j.user_id = ?
        `;
        if (journalId) { sql += ' AND t.journal_id = ?'; params.push(journalId); }
        if (enabledOnly) { sql += ' AND t.is_enabled = 1'; }
        sql += ' ORDER BY c.name ASC, s.name ASC';

        const [rows] = await db.execute(sql, params);
        return rows;
    }

    // =========================================================
    // --- LIAISON COURS PROLIXE <-> COURS SMARTSCHOOL ---
    // =========================================================

    static async getTargets(req, res) {
        const { journal_id } = req.query;
        try {
            const targets = await SmartschoolController.withConnection(
                (db) => SmartschoolController.listTargets(db, req.user.id, { journalId: journal_id || null })
            );
            res.json({ success: true, data: targets });
        } catch (error) {
            SmartschoolController.handleError(res, error, 'Erreur récupération des cours reliés.');
        }
    }

    /**
     * Les cours du journal — classe × matière — avec leur liaison s'il y en a une.
     *
     * C'est la liste que l'interface doit montrer : « 3 TIN — Informatique » et
     * « 3 TIN — Exploitation logiciels » sont deux cours, deux actualités, deux
     * réglages. Elle se lit dans l'horaire, seul endroit qui apparie les deux.
     */
    static async getCourses(req, res) {
        const { journal_id } = req.query;
        if (!journal_id) {
            return res.status(400).json({ success: false, message: 'journal_id est requis.' });
        }

        try {
            const courses = await SmartschoolController.withConnection(async (db) => {
                await SmartschoolController.assertOwnsJournal(db, journal_id, req.user.id);

                const [rows] = await db.execute(`
                    SELECT DISTINCT c.id AS class_id, c.name AS class_name,
                           s.id AS subject_id, s.name AS subject_name
                    FROM SCHEDULE_SLOTS ss
                    JOIN CLASSES c ON ss.class_id = c.id
                    JOIN SUBJECTS s ON ss.subject_id = s.id
                    WHERE c.journal_id = ?
                    ORDER BY c.name ASC, s.name ASC
                `, [journal_id]);

                const targets = await SmartschoolController.listTargets(
                    db, req.user.id, { journalId: journal_id }
                );
                const parCours = new Map(targets.map((t) => [`${t.class_id}:${t.subject_id}`, t]));

                return rows.map((r) => ({
                    class_id: r.class_id,
                    class_name: r.class_name,
                    subject_id: r.subject_id,
                    subject_name: r.subject_name,
                    target: parCours.get(`${r.class_id}:${r.subject_id}`) || null,
                }));
            });

            res.json({ success: true, data: courses });
        } catch (error) {
            SmartschoolController.handleError(
                res, error, 'Erreur récupération des cours.', error.status || 500
            );
        }
    }

    static async upsertTarget(req, res) {
        const {
            journal_id, class_id, subject_id, course_id, ss_id, news_id, title, is_enabled,
        } = req.body;

        // `ss_id` est facultatif : mesuré le 13 septembre 2026, Smartschool sert
        // la page d'actualité sans lui. L'exiger obligerait à en inventer un —
        // et un ssID faux est plus dangereux qu'un ssID absent.
        if (!journal_id || !class_id || !subject_id || !course_id) {
            return res.status(400).json({
                success: false,
                message: 'journal_id, class_id, subject_id et course_id sont requis.',
            });
        }

        try {
            const id = await SmartschoolController.withConnection(async (db) => {
                await SmartschoolController.assertOwnsJournal(db, journal_id, req.user.id);

                // La clé est le cours : classe ET matière. Deux cours d'une
                // même classe visent deux actualités Smartschool distinctes.
                const [existing] = await db.execute(
                    `SELECT id, course_id, ss_id, news_id FROM SMARTSCHOOL_TARGETS
                     WHERE journal_id = ? AND class_id = ? AND subject_id = ?`,
                    [journal_id, class_id, subject_id]
                );

                const safeTitle = (title || '').trim() || 'Journal de classe';
                const enabled = is_enabled === undefined ? 1 : (is_enabled ? 1 : 0);

                const safeNewsId = news_id ? String(news_id) : null;

                if (existing.length > 0) {
                    const previous = existing[0];
                    // Changer de cours cible, c'est viser une autre actualité :
                    // l'ancien news_id et l'empreinte ne valent plus rien.
                    const movedCourse = String(previous.course_id) !== String(course_id)
                        || String(previous.ss_id) !== String(ss_id || '');

                    // Un newsID fourni fait toujours autorité : c'est ainsi qu'on
                    // vise une actualité déjà en ligne plutôt que d'en créer une
                    // seconde à côté. Viser une autre actualité rend l'empreinte
                    // caduque — son contenu n'a rien à voir.
                    const changedNews = safeNewsId && safeNewsId !== previous.news_id;
                    const resetHash = movedCourse || changedNews;

                    await db.execute(`
                        UPDATE SMARTSCHOOL_TARGETS
                        SET course_id = ?, ss_id = ?, title = ?, is_enabled = ?,
                            news_id = ${safeNewsId ? '?' : (movedCourse ? 'NULL' : 'news_id')},
                            published_hash = ${resetHash ? 'NULL' : 'published_hash'},
                            last_error = NULL, last_error_at = NULL
                        WHERE id = ?
                    `, safeNewsId
                        ? [String(course_id), String(ss_id || ''), safeTitle, enabled, safeNewsId, previous.id]
                        : [String(course_id), String(ss_id || ''), safeTitle, enabled, previous.id]);
                    return previous.id;
                }

                const [ins] = await db.execute(`
                    INSERT INTO SMARTSCHOOL_TARGETS
                    (journal_id, class_id, subject_id, course_id, ss_id, news_id, title, is_enabled)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `, [journal_id, class_id, subject_id, String(course_id), String(ss_id || ''), safeNewsId, safeTitle, enabled]);
                return ins.insertId;
            });

            res.json({ success: true, data: { id } });
        } catch (error) {
            SmartschoolController.handleError(
                res, error, 'Erreur enregistrement du cours relié.', error.status || 500
            );
        }
    }

    static async deleteTarget(req, res) {
        try {
            await SmartschoolController.withConnection(async (db) => {
                const [rows] = await db.execute(`
                    SELECT t.id FROM SMARTSCHOOL_TARGETS t
                    JOIN JOURNALS j ON t.journal_id = j.id
                    WHERE t.id = ? AND j.user_id = ?
                `, [req.params.id, req.user.id]);

                if (rows.length === 0) {
                    const error = new Error('Liaison introuvable.');
                    error.status = 404;
                    throw error;
                }
                await db.execute('DELETE FROM SMARTSCHOOL_TARGETS WHERE id = ?', [req.params.id]);
            });
            res.json({ success: true, message: 'Liaison supprimée.' });
        } catch (error) {
            SmartschoolController.handleError(
                res, error, 'Erreur suppression de la liaison.', error.status || 500
            );
        }
    }

    // =========================================================
    // --- APERÇU (ce que l'enseignante verra partir) ---
    // =========================================================

    static async preview(req, res) {
        try {
            const payload = await SmartschoolController.withConnection(async (db) => {
                const [rows] = await db.execute(`
                    SELECT t.*, c.name AS class_name, s.name AS subject_name
                    FROM SMARTSCHOOL_TARGETS t
                    JOIN JOURNALS j ON t.journal_id = j.id
                    JOIN CLASSES c ON t.class_id = c.id
                    LEFT JOIN SUBJECTS s ON t.subject_id = s.id
                    WHERE t.id = ? AND j.user_id = ?
                `, [req.params.id, req.user.id]);

                if (rows.length === 0) {
                    const error = new Error('Liaison introuvable.');
                    error.status = 404;
                    throw error;
                }

                const target = rows[0];
                // Les assignations brutes n'ont rien à faire dans un aperçu.
                const { assignments, assignmentKeys, ...content } =
                    await SmartschoolController.buildContent(db, target);
                return {
                    target_id: target.id,
                    class_name: target.class_name,
                    subject_name: target.subject_name,
                    title: target.title,
                    is_published: target.published_hash === content.hash,
                    ...content,
                };
            });
            res.json({ success: true, data: payload });
        } catch (error) {
            SmartschoolController.handleError(
                res, error, 'Erreur génération de l\'aperçu.', error.status || 500
            );
        }
    }

    // =========================================================
    // --- FILE DE PUBLICATION (consommée par l'extension) ---
    // =========================================================

    /**
     * Ce qui reste à publier : un cours n'y figure que si son contenu diffère
     * de ce qui a réellement été posé dans Smartschool.
     */
    static async pending(req, res) {
        try {
            const items = await SmartschoolController.withConnection(async (db) => {
                const targets = await SmartschoolController.listTargets(
                    db, req.user.id, { enabledOnly: true }
                );

                const out = [];
                for (const target of targets) {
                    const content = await SmartschoolController.buildContent(db, target);
                    const publiees = parseKeys(target.published_assignments);

                    if (content.hash === target.published_hash) {
                        // En ligne et à jour, mais publié avant que l'on retienne
                        // les assignations : ce qui est en ligne est exactement
                        // ce qu'on a sous les yeux, on peut donc le retenir.
                        if (publiees === null) {
                            await db.execute(
                                'UPDATE SMARTSCHOOL_TARGETS SET published_assignments = ? WHERE id = ?',
                                [JSON.stringify(content.assignmentKeys), target.id]
                            );
                        }
                        continue;
                    }

                    const nouvelles = newKeys(content.assignmentKeys, publiees);
                    const libelles = content.assignments
                        .filter((a) => nouvelles.includes(String(a.id)))
                        .map((a) => `${a.type}${a.subject ? ` ${a.subject}` : ''}`);

                    out.push({
                        target_id: target.id,
                        class_name: target.class_name,
                        subject_name: target.subject_name,
                        course_id: target.course_id,
                        ss_id: target.ss_id,
                        news_id: target.news_id,
                        title: target.title,
                        hash: content.hash,
                        html: content.html,
                        text: content.text,
                        row_count: content.rows.length,
                        // Prévenir les élèves seulement si une interro ou une
                        // prépa vient d'apparaître — pas pour une retouche.
                        notify: nouvelles.length > 0,
                        new_assignments: libelles,
                        assignment_keys: content.assignmentKeys,
                    });
                }
                return out;
            });

            res.json({ success: true, data: items });
        } catch (error) {
            SmartschoolController.handleError(res, error, 'Erreur lecture de la file de publication.');
        }
    }

    /**
     * L'extension confirme la pose. `hash` est celui qu'elle a reçu : si le
     * journal a changé entre-temps, le cours repassera simplement en attente.
     */
    static async markPublished(req, res) {
        const { target_id, hash, news_id, assignment_keys } = req.body;
        // Absent (extension antérieure) : on garde ce qui était retenu.
        const keys = Array.isArray(assignment_keys)
            ? JSON.stringify(assignment_keys.map(String))
            : null;

        if (!target_id || !hash) {
            return res.status(400).json({ success: false, message: 'target_id et hash sont requis.' });
        }

        try {
            await SmartschoolController.withConnection(async (db) => {
                const [result] = await db.execute(`
                    UPDATE SMARTSCHOOL_TARGETS t
                    JOIN JOURNALS j ON t.journal_id = j.id
                    SET t.published_hash = ?,
                        t.published_at = NOW(),
                        t.news_id = COALESCE(?, t.news_id),
                        t.published_assignments = COALESCE(?, t.published_assignments),
                        t.last_error = NULL,
                        t.last_error_at = NULL
                    WHERE t.id = ? AND j.user_id = ?
                `, [hash, news_id ? String(news_id) : null, keys, target_id, req.user.id]);

                if (result.affectedRows === 0) {
                    const error = new Error('Liaison introuvable.');
                    error.status = 404;
                    throw error;
                }
            });
            res.json({ success: true });
        } catch (error) {
            SmartschoolController.handleError(
                res, error, 'Erreur enregistrement de la publication.', error.status || 500
            );
        }
    }

    /**
     * L'extension signale un échec. On garde le message : un échec silencieux
     * ferait croire à une publication faite.
     */
    static async markFailed(req, res) {
        const { target_id, error: message } = req.body;

        if (!target_id) {
            return res.status(400).json({ success: false, message: 'target_id est requis.' });
        }

        try {
            await SmartschoolController.withConnection(async (db) => {
                await db.execute(`
                    UPDATE SMARTSCHOOL_TARGETS t
                    JOIN JOURNALS j ON t.journal_id = j.id
                    SET t.last_error = ?, t.last_error_at = NOW()
                    WHERE t.id = ? AND j.user_id = ?
                `, [String(message || 'Erreur inconnue').slice(0, 1000), target_id, req.user.id]);
            });
            res.json({ success: true });
        } catch (err) {
            SmartschoolController.handleError(res, err, 'Erreur enregistrement de l\'échec.');
        }
    }

    // =========================================================
    // --- RAPPELS D'INTERRO (une actualité par interro, de J-2 à J) ---
    // =========================================================

    /**
     * Les rappels à poser ou à retirer.
     *
     * Un rappel n'est créé qu'une fois entré dans sa fenêtre (J-2 à J), et
     * c'est ce moment-là qui notifie : la notification accompagne l'apparition.
     * Il disparaît seul après le jour J (date de fin de visibilité) ; on ne le
     * retire à la main que si l'interro est supprimée, exclue ou déplacée hors
     * de la fenêtre avant d'avoir eu lieu.
     */
    static async pendingReminders(req, res) {
        try {
            const items = await SmartschoolController.withConnection(async (db) => {
                const targets = await SmartschoolController.listTargets(
                    db, req.user.id, { enabledOnly: true }
                );
                const today = todayKey();
                const out = [];

                for (const target of targets) {
                    const [interros] = await db.execute(`
                        SELECT a.id, a.due_date, a.type, a.subject, a.description
                        FROM ASSIGNMENTS a
                        LEFT JOIN SCHEDULE_SLOTS ss ON a.schedule_slot_id = ss.id
                        WHERE a.journal_id = ? AND a.class_id = ?
                          AND (ss.subject_id = ? OR a.schedule_slot_id IS NULL)
                          AND a.type IN (${REMINDER_TYPES.map(() => '?').join(', ')})
                          AND COALESCE(a.exclude_from_smartschool, 0) = 0
                    `, [target.journal_id, target.class_id, target.subject_id, ...REMINDER_TYPES]);

                    const [lignes] = await db.execute(
                        'SELECT * FROM SMARTSCHOOL_REMINDERS WHERE target_id = ?',
                        [target.id]
                    );
                    const parInterro = new Map(lignes.map((r) => [String(r.assignment_id), r]));

                    const base = {
                        target_id: target.id,
                        class_name: target.class_name,
                        subject_name: target.subject_name,
                        course_id: target.course_id,
                        ss_id: target.ss_id,
                    };

                    const attendus = new Set();
                    for (const a of interros) {
                        if (!isInReminderWindow(a.due_date, today)) continue;
                        attendus.add(String(a.id));

                        const rappel = buildReminder(a);
                        const ligne = parInterro.get(String(a.id));
                        if (ligne && ligne.published_hash === rappel.hash) continue;

                        out.push({
                            ...base,
                            assignment_id: a.id,
                            news_id: ligne?.news_id || null,
                            due_date: toDateKey(a.due_date),
                            title: rappel.title,
                            html: rappel.html,
                            visible: true,
                            visible_from: rappel.visibleFrom,
                            visible_till: rappel.visibleTill,
                            hash: rappel.hash,
                            // Notifier à l'apparition, pas à chaque retouche.
                            notify: !(ligne && ligne.visible && ligne.news_id),
                        });
                    }

                    // Interro supprimée, exclue ou déplacée avant d'avoir eu lieu :
                    // son rappel ne doit pas rester en ligne.
                    for (const ligne of lignes) {
                        if (attendus.has(String(ligne.assignment_id))) continue;
                        if (!ligne.visible || !ligne.news_id) continue;
                        if (toDateKey(ligne.due_date) < today) continue;   // expiré tout seul

                        out.push({
                            ...base,
                            assignment_id: ligne.assignment_id,
                            news_id: ligne.news_id,
                            due_date: toDateKey(ligne.due_date),
                            title: ligne.title,
                            html: ligne.html,
                            visible: false,
                            visible_from: null,
                            visible_till: null,
                            hash: hiddenHash(ligne.title, ligne.html),
                            notify: false,
                        });
                    }
                }
                return out;
            });

            res.json({ success: true, data: items });
        } catch (error) {
            SmartschoolController.handleError(res, error, 'Erreur lecture des rappels d\'interro.');
        }
    }

    /** Vérifie que la liaison appartient à l'utilisateur connecté. */
    static async assertOwnsTarget(db, targetId, userId) {
        const [rows] = await db.execute(`
            SELECT t.id FROM SMARTSCHOOL_TARGETS t
            JOIN JOURNALS j ON t.journal_id = j.id
            WHERE t.id = ? AND j.user_id = ?
        `, [targetId, userId]);
        if (rows.length === 0) {
            const error = new Error('Liaison introuvable.');
            error.status = 404;
            throw error;
        }
    }

    /** L'extension confirme la pose (ou le retrait) d'un rappel. */
    static async markReminderPublished(req, res) {
        const {
            target_id, assignment_id, hash, news_id, due_date, title, html, visible,
        } = req.body;

        if (!target_id || !assignment_id || !hash) {
            return res.status(400).json({
                success: false, message: 'target_id, assignment_id et hash sont requis.',
            });
        }

        try {
            await SmartschoolController.withConnection(async (db) => {
                await SmartschoolController.assertOwnsTarget(db, target_id, req.user.id);
                await db.execute(`
                    INSERT INTO SMARTSCHOOL_REMINDERS
                        (target_id, assignment_id, news_id, due_date, title, html, visible,
                         published_hash, published_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
                    ON DUPLICATE KEY UPDATE
                        news_id = COALESCE(VALUES(news_id), news_id),
                        due_date = VALUES(due_date),
                        title = VALUES(title),
                        html = VALUES(html),
                        visible = VALUES(visible),
                        published_hash = VALUES(published_hash),
                        published_at = NOW(),
                        last_error = NULL,
                        last_error_at = NULL
                `, [
                    target_id, assignment_id, news_id ? String(news_id) : null,
                    due_date || null, String(title || '').slice(0, 255), html ?? null,
                    visible ? 1 : 0, hash,
                ]);
            });
            res.json({ success: true });
        } catch (error) {
            SmartschoolController.handleError(
                res, error, 'Erreur enregistrement du rappel.', error.status || 500
            );
        }
    }

    /** L'extension signale l'échec d'un rappel. */
    static async markReminderFailed(req, res) {
        const { target_id, assignment_id, error: message } = req.body;
        if (!target_id || !assignment_id) {
            return res.status(400).json({
                success: false, message: 'target_id et assignment_id sont requis.',
            });
        }

        try {
            await SmartschoolController.withConnection(async (db) => {
                await SmartschoolController.assertOwnsTarget(db, target_id, req.user.id);
                await db.execute(`
                    INSERT INTO SMARTSCHOOL_REMINDERS (target_id, assignment_id, last_error, last_error_at)
                    VALUES (?, ?, ?, NOW())
                    ON DUPLICATE KEY UPDATE last_error = VALUES(last_error), last_error_at = NOW()
                `, [target_id, assignment_id, String(message || 'Erreur inconnue').slice(0, 1000)]);
            });
            res.json({ success: true });
        } catch (err) {
            SmartschoolController.handleError(
                res, err, 'Erreur enregistrement de l\'échec du rappel.', err.status || 500
            );
        }
    }

    // =========================================================
    // --- EXCLUSION D'UNE LIGNE ---
    // =========================================================

    /**
     * Retire (ou remet) une entrée de journal ou une assignation du contenu
     * publié. Les notes internes n'ont pas à atteindre les élèves.
     */
    static async setExclusion(req, res) {
        const { kind, id, excluded } = req.body;

        const table = kind === 'entry' ? 'JOURNAL_ENTRIES'
            : kind === 'assignment' ? 'ASSIGNMENTS'
                : null;

        if (!table || !id) {
            return res.status(400).json({
                success: false,
                message: 'kind ("entry" ou "assignment") et id sont requis.',
            });
        }

        try {
            await SmartschoolController.withConnection(async (db) => {
                const [rows] = await db.execute(`
                    SELECT t.id FROM ${table} t
                    JOIN JOURNALS j ON t.journal_id = j.id
                    WHERE t.id = ? AND j.user_id = ?
                `, [id, req.user.id]);

                if (rows.length === 0) {
                    const error = new Error('Élément introuvable.');
                    error.status = 404;
                    throw error;
                }

                await db.execute(
                    `UPDATE ${table} SET exclude_from_smartschool = ? WHERE id = ?`,
                    [excluded ? 1 : 0, id]
                );
            });
            res.json({ success: true });
        } catch (error) {
            SmartschoolController.handleError(
                res, error, 'Erreur mise à jour de l\'exclusion.', error.status || 500
            );
        }
    }
}

module.exports = SmartschoolController;
