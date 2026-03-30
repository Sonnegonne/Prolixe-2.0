// backend/controllers/journalController.js
const pool = require('../../config/database');

/**
 * Transforme une date type "mardi 05 nov. 2024" en objet Date JS
 */
const parseFrenchDate = (dateStr) => {
    if (!dateStr || typeof dateStr !== 'string') return null;

    const months = {
        'janv.': 0, 'févr.': 1, 'mars': 2, 'avr.': 3, 'mai': 4, 'juin': 5,
        'juil.': 6, 'août': 7, 'sept.': 8, 'oct.': 9, 'nov.': 10, 'déc.': 11
    };

    const parts = dateStr.toLowerCase().split(' ');
    if (parts.length < 4) return null;

    const day = parseInt(parts[1], 10);
    const month = months[parts[2]];
    const year = parseInt(parts[3], 10);

    if (isNaN(day) || month === undefined || isNaN(year)) return null;

    return new Date(year, month, day);
};

/**
 * Récupère le nom du jour en anglais pour matcher la base de données
 */
const getDayKeyFromDate = (date) =>
    ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][date.getDay()];

class JournalController {

    // =========================================================
    // --- UTILITAIRES ---
    // =========================================================

    static async withConnection(operation) {
        let connection;
        try {
            connection = await pool.getConnection();
            return await operation(connection);
        } catch (error) {
            console.error('Erreur SQL (JournalController):', error.message);
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
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }

    // =========================================================
    // --- GESTION DES JOURNAUX (Table JOURNALS) ---
    // =========================================================

    static async getAllJournals(req, res) {
        try {
            const userId = req.user.id;
            const journals = await JournalController.withConnection(async (db) => {
                const [rows] = await db.execute(`
                    SELECT j.*, sy.label AS year_label,
                    (SELECT COUNT(*) FROM JOURNAL_ENTRIES je WHERE je.journal_id = j.id) AS entries_count
                    FROM JOURNALS j
                    JOIN SCHOOL_YEARS sy ON j.school_year_id = sy.id
                    WHERE j.user_id = ?
                    ORDER BY sy.start_date DESC
                `, [userId]);
                return rows;
            });
            res.json({ success: true, data: journals });
        } catch (error) {
            JournalController.handleError(res, error, 'Erreur récupération journaux.');
        }
    }

    static async getCurrentJournal(req, res) {
        try {
            const [journal] = await JournalController.withConnection(async (db) => {
                const [rows] = await db.execute(
                    'SELECT * FROM JOURNALS WHERE user_id = ? AND is_current = 1 LIMIT 1',
                    [req.user.id]
                );
                return rows;
            });
            res.json({ success: true, data: journal || null });
        } catch (error) {
            JournalController.handleError(res, error, 'Erreur récupération journal courant.');
        }
    }

    static async createJournal(req, res) {
        const { name, school_year_id } = req.body;
        const userId = req.user.id;

        if (!name || !school_year_id) {
            return res.status(400).json({ success: false, message: 'Nom et année scolaire requis.' });
        }

        let connection;
        try {
            connection = await pool.getConnection();
            await connection.beginTransaction();

            // Désactiver le journal courant de l'utilisateur
            await connection.execute(
                'UPDATE JOURNALS SET is_current = 0 WHERE user_id = ?',
                [userId]
            );

            const [result] = await connection.execute(
                'INSERT INTO JOURNALS (name, school_year_id, user_id, is_current, is_archived, created_at) VALUES (?, ?, ?, 1, 0, NOW())',
                [name, school_year_id, userId]
            );

            await connection.commit();
            res.status(201).json({ success: true, data: { id: result.insertId } });
        } catch (error) {
            if (connection) await connection.rollback();
            JournalController.handleError(res, error, 'Erreur création journal.');
        } finally {
            if (connection) connection.release();
        }
    }

    static async exportJournal(req, res) {
        const { id } = req.params;
        const userId = req.user.id;

        try {
            const exportData = await JournalController.withConnection(async (db) => {
                // 1. Vérifier l'existence et l'ownership du journal
                const [journals] = await db.execute(
                    'SELECT * FROM JOURNALS WHERE id = ? AND user_id = ?',
                    [id, userId]
                );

                if (journals.length === 0) return null;

                const journal = journals[0];

                // 2. Récupérer les entrées du journal
                const [entries] = await db.execute(`
                SELECT je.*, ss.day_of_week, h.libelle as time_label
                FROM JOURNAL_ENTRIES je
                JOIN SCHEDULE_SLOTS ss ON je.schedule_slot_id = ss.id
                JOIN SCH_HOURS h ON ss.time_slot_id = h.id
                WHERE je.journal_id = ?
                ORDER BY je.entry_date ASC, h.id ASC
            `, [id]);

                // 3. Récupérer les devoirs (assignments)
                const [assignments] = await db.execute(
                    'SELECT * FROM ASSIGNMENTS WHERE journal_id = ? ORDER BY due_date ASC',
                    [id]
                );

                return {
                    metadata: {
                        name: journal.name,
                        export_date: new Date(),
                        version: "2.0"
                    },
                    journal_info: journal,
                    entries: entries,
                    assignments: assignments
                };
            });

            if (!exportData) {
                return res.status(404).json({ success: false, message: 'Journal introuvable.' });
            }

            // Paramétrage du header pour le téléchargement du fichier
            const fileName = `export_journal_${id}_${new Date().toISOString().split('T')[0]}.json`;
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);

            res.send(JSON.stringify(exportData, null, 2));

        } catch (error) {
            JournalController.handleError(res, error, 'Erreur lors de l\'exportation du journal.');
        }
    }

    /**
     * Archive un journal (is_archived = 1).
     * Si c'était le journal courant, on tente d'en promouvoir un autre.
     */
    static async archiveJournal(req, res) {
        const { id } = req.params;
        const userId = req.user.id;

        let connection;
        try {
            connection = await pool.getConnection();
            await connection.beginTransaction();

            // Vérification d'ownership
            const [journals] = await connection.execute(
                'SELECT * FROM JOURNALS WHERE id = ? AND user_id = ?',
                [id, userId]
            );
            if (journals.length === 0) {
                await connection.rollback();
                return res.status(404).json({ success: false, message: 'Journal introuvable.' });
            }

            const journal = journals[0];

            // Archiver
            await connection.execute(
                'UPDATE JOURNALS SET is_archived = 1, is_current = 0 WHERE id = ?',
                [id]
            );

            // Si c'était le journal courant, promouvoir le plus récent non archivé
            if (journal.is_current) {
                const [candidates] = await connection.execute(
                    `SELECT id FROM JOURNALS 
                     WHERE user_id = ? AND is_archived = 0 AND id != ?
                     ORDER BY created_at DESC LIMIT 1`,
                    [userId, id]
                );
                if (candidates.length > 0) {
                    await connection.execute(
                        'UPDATE JOURNALS SET is_current = 1 WHERE id = ?',
                        [candidates[0].id]
                    );
                }
            }

            await connection.commit();
            res.json({ success: true, message: 'Journal archivé avec succès.' });
        } catch (error) {
            if (connection) await connection.rollback();
            JournalController.handleError(res, error, 'Erreur archivage journal.');
        } finally {
            if (connection) connection.release();
        }
    }

    /**
     * Supprime définitivement un journal et toutes ses entrées / assignations.
     */
    static async deleteJournal(req, res) {
        const { id } = req.params;
        const userId = req.user.id;

        let connection;
        try {
            connection = await pool.getConnection();
            await connection.beginTransaction();

            // Vérification d'ownership
            const [journals] = await connection.execute(
                'SELECT id, is_current FROM JOURNALS WHERE id = ? AND user_id = ?',
                [id, userId]
            );
            if (journals.length === 0) {
                await connection.rollback();
                return res.status(404).json({ success: false, message: 'Journal introuvable.' });
            }

            // Suppression en cascade (si pas de FK CASCADE en base)
            await connection.execute('DELETE FROM JOURNAL_ENTRIES WHERE journal_id = ?', [id]);
            await connection.execute('DELETE FROM ASSIGNMENTS WHERE journal_id = ?', [id]);
            await connection.execute('DELETE FROM JOURNALS WHERE id = ?', [id]);

            // Si c'était le journal courant, promouvoir un autre
            if (journals[0].is_current) {
                const [candidates] = await connection.execute(
                    `SELECT id FROM JOURNALS 
                     WHERE user_id = ? AND is_archived = 0
                     ORDER BY created_at DESC LIMIT 1`,
                    [userId]
                );
                if (candidates.length > 0) {
                    await connection.execute(
                        'UPDATE JOURNALS SET is_current = 1 WHERE id = ?',
                        [candidates[0].id]
                    );
                }
            }

            await connection.commit();
            res.json({ success: true, message: 'Journal supprimé avec succès.' });
        } catch (error) {
            if (connection) await connection.rollback();
            JournalController.handleError(res, error, 'Erreur suppression journal.');
        } finally {
            if (connection) connection.release();
        }
    }

    /**
     * Vide toutes les entrées d'un journal sans le supprimer.
     */
    static async clearJournal(req, res) {
        const { journal_id } = req.params;
        const userId = req.user.id;

        let connection;
        try {
            connection = await pool.getConnection();
            await connection.beginTransaction();

            // Vérification d'ownership
            const [journals] = await connection.execute(
                'SELECT id FROM JOURNALS WHERE id = ? AND user_id = ?',
                [journal_id, userId]
            );
            if (journals.length === 0) {
                await connection.rollback();
                return res.status(404).json({ success: false, message: 'Journal introuvable.' });
            }

            const [result] = await connection.execute(
                'DELETE FROM JOURNAL_ENTRIES WHERE journal_id = ?',
                [journal_id]
            );

            await connection.commit();
            res.json({
                success: true,
                message: `${result.affectedRows} entrée(s) supprimée(s).`,
                data: { deleted: result.affectedRows }
            });
        } catch (error) {
            if (connection) await connection.rollback();
            JournalController.handleError(res, error, 'Erreur vidage journal.');
        } finally {
            if (connection) connection.release();
        }
    }

    // =========================================================
    // --- ENTRÉES DE JOURNAL (Table JOURNAL_ENTRIES) ---
    // =========================================================

    static async getJournalEntries(req, res) {
        const { journal_id, startDate, endDate } = req.query;

        if (!journal_id || !startDate || !endDate) {
            return res.status(400).json({ success: false, message: 'journal_id, startDate et endDate sont requis.' });
        }

        try {
            const entries = await JournalController.withConnection(async (db) => {
                const [rows] = await db.execute(`
                    SELECT * FROM JOURNAL_ENTRIES 
                    WHERE journal_id = ? AND entry_date BETWEEN ? AND ?
                    ORDER BY entry_date ASC
                `, [journal_id, startDate, endDate]);
                return rows;
            });
            res.json({ success: true, data: entries });
        } catch (error) {
            JournalController.handleError(res, error, 'Erreur récupération entrées.');
        }
    }

    static async upsertJournalEntry(req, res) {
        const { id, journal_id, schedule_slot_id, date, planned_work, actual_work, notes } = req.body;
        console.log(req.body);

        if (!journal_id || !schedule_slot_id || !date) {
            return res.status(400).json({ success: false, message: 'journal_id, schedule_slot_id et date sont requis.' });
        }

        try {
            const resultId = await JournalController.withConnection(async (db) => {
                // Recherche par clé métier si pas d'id fourni
                const [existing] = await db.execute(
                    'SELECT id FROM JOURNAL_ENTRIES WHERE journal_id = ? AND schedule_slot_id = ? AND entry_date = ?',
                    [journal_id, schedule_slot_id, date]
                );
                const targetId = id || (existing.length > 0 ? existing[0].id : null);

                if (targetId) {
                    await db.execute(`
                        UPDATE JOURNAL_ENTRIES 
                        SET content_planned = ?, content_done = ?, homework = ?, entry_date = ?
                        WHERE id = ?
                    `, [planned_work ?? null, actual_work ?? null, notes ?? null, date, targetId]);
                    return targetId;
                } else {
                    const [ins] = await db.execute(`
                        INSERT INTO JOURNAL_ENTRIES 
                        (journal_id, schedule_slot_id, entry_date, content_planned, content_done, homework)
                        VALUES (?, ?, ?, ?, ?, ?)
                    `, [journal_id, schedule_slot_id, date, planned_work ?? null, actual_work ?? null, notes ?? null]);
                    return ins.insertId;
                }
            });
            res.json({ success: true, data: { id: resultId } });
        } catch (error) {
            JournalController.handleError(res, error, 'Erreur sauvegarde entrée.');
        }
    }

    // =========================================================
    // --- IMPORTATION DEPUIS JSON ---
    // =========================================================

    static async importJournal(req, res) {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Fichier JSON requis.' });
        }
        const { journal_id } = req.body;
        if (!journal_id) {
            return res.status(400).json({ success: false, message: 'journal_id requis.' });
        }

        let connection;
        try {
            let data;
            try {
                const parsed = JSON.parse(req.file.buffer.toString('utf8'));

                // Format export v2.0 : { metadata, journal_info, entries, assignments }
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray(parsed.entries)) {
                    data = parsed.entries;
                }
                // Format JDC legacy : tableau de sessions directement
                else if (Array.isArray(parsed)) {
                    data = parsed;
                } else {
                    return res.status(400).json({ success: false, message: 'Format JSON non reconnu : tableau ou export v2.0 attendu.' });
                }
            } catch {
                return res.status(400).json({ success: false, message: 'Fichier JSON invalide.' });
            }

            connection = await pool.getConnection();
            await connection.beginTransaction();

            const [slots] = await connection.execute(`
                SELECT
                    ss.id,
                    ss.day_of_week,
                    ss.class_id,
                    ss.time_slot_id,
                    SUBSTRING_INDEX(h.libelle, '-', 1) AS start_time,
                    SUBSTRING_INDEX(h.libelle, '-', -1) AS end_time
                FROM SCHEDULE_SLOTS ss
                         JOIN SCHEDULE_SETS sets ON ss.schedule_set_id = sets.id
                         JOIN SCH_HOURS h ON ss.time_slot_id = h.id
                WHERE sets.journal_id = ?
                ORDER BY ss.day_of_week ASC, ss.time_slot_id ASC
            `, [journal_id]);

            let importedCount = 0;
            let skippedCount = 0;

            for (const session of data) {
                if (!session.date) continue;

                const dateObj = parseFrenchDate(session.date);
                if (!dateObj) continue;

                const dayOfWeek = dateObj.getDay();

                // Pré-calcul des heures déjà explicitement présentes dans ce session
                // pour éviter d'écraser une entrée JSON avec le contenu d'une autre
                const explicitTimes = new Set(
                    (session.activites || [])
                        .filter(a => a.heure)
                        .map(a => a.heure.replace('h', ':'))
                );

                for (const act of (session.activites || [])) {
                    if (!act.heure || !act.description) continue;

                    const jsonTime = act.heure.replace('h', ':');

                    const startIndex = slots.findIndex(s =>
                        s.day_of_week === dayOfWeek &&
                        s.start_time === jsonTime
                    );

                    if (startIndex === -1) {
                        console.warn(`[import] Slot introuvable — jour: ${dayOfWeek}, heure: ${jsonTime}`);
                        skippedCount++;
                        continue;
                    }

                    const startSlot = slots[startIndex];
                    const matchingSlots = [startSlot];
                    let prevSlot = startSlot;

                    for (let i = startIndex + 1; i < slots.length; i++) {
                        const next = slots[i];

                        // Arrêt si on change de jour ou de classe
                        if (next.day_of_week !== dayOfWeek || next.class_id !== startSlot.class_id) break;

                        // Arrêt si le slot suivant n'est pas consécutif dans la grille
                        if (next.time_slot_id !== prevSlot.time_slot_id + 1) break;

                        // Arrêt si ce slot suivant a déjà une entrée explicite dans le JSON :
                        // on ne doit pas l'écraser avec le contenu de l'activité courante
                        if (explicitTimes.has(next.start_time)) break;

                        matchingSlots.push(next);
                        prevSlot = next;
                    }

                    for (const slot of matchingSlots) {
                        await connection.execute(`
                        INSERT INTO JOURNAL_ENTRIES 
                            (journal_id, schedule_slot_id, entry_date, content_done)
                        VALUES (?, ?, ?, ?)
                        ON DUPLICATE KEY UPDATE content_done = VALUES(content_done)
                    `, [journal_id, slot.id, dateObj, act.description]);
                        importedCount++;
                    }
                }
            }

            await connection.commit();
            res.json({
                success: true,
                message: `${importedCount} entrée(s) insérée(s) sur ${importedCount} slot(s), ${skippedCount} activité(s) ignorée(s).`,
                data: { imported: importedCount, skipped: skippedCount }
            });

        } catch (error) {
            if (connection) await connection.rollback();
            JournalController.handleError(res, error, "Échec de l'importation.");
        } finally {
            if (connection) connection.release();
        }
    }

    // =========================================================
    // --- ASSIGNATIONS / DEVOIRS (Table ASSIGNMENTS) ---
    // =========================================================

    static async getAssignments(req, res) {
        const { journal_id, startDate, endDate } = req.query;

        if (!journal_id || !startDate || !endDate) {
            return res.status(400).json({ success: false, message: 'journal_id, startDate et endDate sont requis.' });
        }

        try {
            const assignments = await JournalController.withConnection(async (db) => {
                const [rows] = await db.execute(`
                    SELECT a.*, c.name AS class_name 
                    FROM ASSIGNMENTS a
                    JOIN CLASSES c ON a.class_id = c.id
                    WHERE a.journal_id = ? AND a.due_date BETWEEN ? AND ?
                    ORDER BY a.due_date ASC
                `, [journal_id, startDate, endDate]);
                return rows;
            });
            res.json({ success: true, data: assignments });
        } catch (error) {
            JournalController.handleError(res, error, 'Erreur récupération devoirs.');
        }
    }

    static async upsertAssignment(req, res) {
        const {
            id, journal_id, class_id, schedule_slot_id,
            subject, type, description, due_date,
            is_completed, is_corrected
        } = req.body;

        if (!class_id || !due_date) {
            return res.status(400).json({ success: false, message: 'class_id et due_date sont requis.' });
        }

        try {
            const resultId = await JournalController.withConnection(async (db) => {
                const fields = [
                    class_id,
                    schedule_slot_id ?? null,
                    subject ?? null,
                    type ?? 'Devoir',
                    description ?? null,
                    due_date,
                    is_completed ? 1 : 0,
                    is_corrected ? 1 : 0
                ];

                if (id) {
                    await db.execute(`
                        UPDATE ASSIGNMENTS 
                        SET class_id = ?, schedule_slot_id = ?, subject = ?, type = ?,
                            description = ?, due_date = ?, is_completed = ?, is_corrected = ?
                        WHERE id = ?
                    `, [...fields, id]);
                    return id;
                } else {
                    if (!journal_id) throw new Error('journal_id requis pour la création.');
                    const [ins] = await db.execute(`
                        INSERT INTO ASSIGNMENTS 
                        (journal_id, class_id, schedule_slot_id, subject, type, description, due_date, is_completed, is_corrected)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [journal_id, ...fields]);
                    return ins.insertId;
                }
            });
            res.json({ success: true, data: { id: resultId } });
        } catch (error) {
            JournalController.handleError(res, error, 'Erreur sauvegarde devoir.');
        }
    }

    static async deleteAssignment(req, res) {
        const { id } = req.params;
        try {
            await JournalController.withConnection(async (db) => {
                await db.execute('DELETE FROM ASSIGNMENTS WHERE id = ?', [id]);
            });
            res.json({ success: true, message: 'Devoir supprimé.' });
        } catch (error) {
            JournalController.handleError(res, error, 'Erreur suppression devoir.');
        }
    }
}

module.exports = JournalController;