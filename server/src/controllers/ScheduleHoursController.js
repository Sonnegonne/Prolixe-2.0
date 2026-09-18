// backend/controllers/ScheduleHoursController.js
//
// Les creneaux horaires ne sont plus forcement les memes partout : deux ecoles
// peuvent decouper la journee differemment (50 min ici, 55 min la, pauses a
// d'autres moments). D'ou `SCH_HOURS.school_id`, avec cette regle unique :
//
//   - une ecole qui possede au moins un creneau propre n'utilise QUE les siens ;
//   - sinon elle lit la grille commune (`school_id IS NULL`), celle qui
//     existait avant les ecoles.
//
// Consequence voulue : rien ne bouge pour l'existant tant qu'on ne detache pas
// une ecole, et un detachement (`detach`) remappe les creneaux deja poses pour
// que l'horaire affiche reste identique.
const pool = require('../../config/database');
const SchoolController = require('./SchoolController');

class ScheduleHoursController {
    // --- Utilitaires privés ---
    static #sendError(res, message, status = 500, error = null) {
        return res.status(status).json({
            success: false,
            message,
            ...(error && { error: error.message })
        });
    }

    static #validateLibelle(libelle) {
        const timeSlotRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]-([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
        if (!libelle || typeof libelle !== 'string' || !timeSlotRegex.test(libelle)) {
            return { valid: false, message: 'Format invalide (attendu: HH:MM-HH:MM)' };
        }
        const [start, end] = libelle.split('-');
        if (start >= end) {
            return { valid: false, message: 'L’heure de fin doit être après l’heure de début' };
        }
        return { valid: true };
    }

    /**
     * Grille effective d'une école. Reutilise par l'horaire, le journal et
     * l'import PDF : c'est le seul endroit qui connait la regle de repli.
     * @returns {{ hours: Array, isOwn: boolean }}
     */
    static async resolveForSchool(executor, schoolId) {
        if (schoolId) {
            const [own] = await executor.execute(
                'SELECT * FROM SCH_HOURS WHERE school_id = ? ORDER BY libelle ASC',
                [schoolId]
            );
            if (own.length > 0) return { hours: own, isOwn: true };
        }
        const [shared] = await executor.execute(
            'SELECT * FROM SCH_HOURS WHERE school_id IS NULL ORDER BY libelle ASC'
        );
        return { hours: shared, isOwn: false };
    }

    // Une ecole detachee gere ses creneaux elle-meme ; la grille commune reste
    // reservee aux administrateurs, comme avant.
    static async #assertWritable(req, schoolId) {
        if (schoolId) {
            await SchoolController.assertOwned(pool, schoolId, req.user.id);
            return;
        }
        if (req.user.role !== 'ADMIN') {
            throw Object.assign(
                new Error("La grille commune n'est modifiable que par un administrateur."),
                { status: 403 }
            );
        }
    }

    static #parseSchoolId(value) {
        const id = parseInt(value, 10);
        return Number.isFinite(id) && id > 0 ? id : null;
    }

    // --- Méthodes publiques ---

    static async getAllHours(req, res) {
        const schoolId = ScheduleHoursController.#parseSchoolId(req.query.schoolId ?? req.query.school_id);
        try {
            if (schoolId) {
                await SchoolController.assertOwned(pool, schoolId, req.user.id);
                const { hours, isOwn } = await ScheduleHoursController.resolveForSchool(pool, schoolId);
                return res.status(200).json({ success: true, data: hours, meta: { school_id: schoolId, is_own: isOwn } });
            }
            // Sans ecole precisee : la grille commune (comportement historique).
            const [rows] = await pool.execute('SELECT * FROM SCH_HOURS WHERE school_id IS NULL ORDER BY libelle ASC');
            res.status(200).json({ success: true, data: rows, meta: { school_id: null, is_own: false } });
        } catch (error) {
            ScheduleHoursController.#sendError(res, error.status ? error.message : 'Erreur de récupération', error.status || 500);
        }
    }

    static async getHourById(req, res) {
        const { id } = req.params;
        if (isNaN(id)) return ScheduleHoursController.#sendError(res, 'ID invalide', 400);

        try {
            const [rows] = await pool.execute('SELECT * FROM SCH_HOURS WHERE id = ?', [id]);
            if (rows.length === 0) return ScheduleHoursController.#sendError(res, 'Créneau non trouvé', 404);

            res.status(200).json({ success: true, data: rows[0] });
        } catch (error) {
            ScheduleHoursController.#sendError(res, 'Erreur serveur', 500, error);
        }
    }

    static async createHour(req, res) {
        const { libelle } = req.body;
        const schoolId = ScheduleHoursController.#parseSchoolId(req.body.school_id ?? req.body.schoolId);

        const check = ScheduleHoursController.#validateLibelle(libelle);
        if (!check.valid) return ScheduleHoursController.#sendError(res, check.message, 400);

        try {
            await ScheduleHoursController.#assertWritable(req, schoolId);

            // L'unicite se joue a l'interieur d'une grille : deux ecoles ont le
            // droit d'avoir toutes deux un « 08:25-09:15 ».
            const [existing] = await pool.execute(
                schoolId
                    ? 'SELECT id FROM SCH_HOURS WHERE libelle = ? AND school_id = ?'
                    : 'SELECT id FROM SCH_HOURS WHERE libelle = ? AND school_id IS NULL',
                schoolId ? [libelle, schoolId] : [libelle]
            );
            if (existing.length > 0) return ScheduleHoursController.#sendError(res, 'Ce créneau existe déjà', 409);

            const [result] = await pool.execute(
                'INSERT INTO SCH_HOURS (libelle, school_id) VALUES (?, ?)',
                [libelle, schoolId]
            );

            res.status(201).json({
                success: true,
                data: { id: result.insertId, libelle, school_id: schoolId },
                message: 'Créneau créé'
            });
        } catch (error) {
            ScheduleHoursController.#sendError(res, error.status ? error.message : 'Erreur de création', error.status || 500);
        }
    }

    static async updateHour(req, res) {
        const { id } = req.params;
        const { libelle } = req.body;

        const check = ScheduleHoursController.#validateLibelle(libelle);
        if (!check.valid || isNaN(id)) return ScheduleHoursController.#sendError(res, check.message || 'ID invalide', 400);

        try {
            const [rows] = await pool.execute('SELECT * FROM SCH_HOURS WHERE id = ?', [id]);
            if (rows.length === 0) return ScheduleHoursController.#sendError(res, 'Créneau non trouvé', 404);
            const hour = rows[0];

            await ScheduleHoursController.#assertWritable(req, hour.school_id);

            const [conflict] = await pool.execute(
                hour.school_id
                    ? 'SELECT id FROM SCH_HOURS WHERE libelle = ? AND id != ? AND school_id = ?'
                    : 'SELECT id FROM SCH_HOURS WHERE libelle = ? AND id != ? AND school_id IS NULL',
                hour.school_id ? [libelle, id, hour.school_id] : [libelle, id]
            );
            if (conflict.length > 0) return ScheduleHoursController.#sendError(res, 'Ce libellé est déjà utilisé', 409);

            await pool.execute('UPDATE SCH_HOURS SET libelle = ? WHERE id = ?', [libelle, id]);
            res.status(200).json({ success: true, data: { id: parseInt(id), libelle, school_id: hour.school_id } });
        } catch (error) {
            ScheduleHoursController.#sendError(res, error.status ? error.message : 'Erreur de mise à jour', error.status || 500);
        }
    }

    static async deleteHour(req, res) {
        const { id } = req.params;
        if (isNaN(id)) return ScheduleHoursController.#sendError(res, 'ID invalide', 400);

        try {
            const [rows] = await pool.execute('SELECT * FROM SCH_HOURS WHERE id = ?', [id]);
            if (rows.length === 0) return ScheduleHoursController.#sendError(res, 'Créneau non trouvé', 404);

            await ScheduleHoursController.#assertWritable(req, rows[0].school_id);

            // Un creneau encore pose dans un horaire laisserait des cours
            // orphelins, invisibles mais toujours en base.
            const [[{ n }]] = await pool.execute(
                'SELECT COUNT(*) AS n FROM SCHEDULE_SLOTS WHERE time_slot_id = ?', [id]
            );
            if (n > 0) {
                return ScheduleHoursController.#sendError(
                    res, `Ce créneau porte encore ${n} cours dans vos horaires.`, 409
                );
            }

            await pool.execute('DELETE FROM SCH_HOURS WHERE id = ?', [id]);
            res.status(200).json({ success: true, message: 'Supprimé avec succès' });
        } catch (error) {
            ScheduleHoursController.#sendError(res, error.status ? error.message : 'Erreur de suppression', error.status || 500);
        }
    }

    /**
     * Donne a une ecole sa grille propre, copiee de la grille commune, et
     * rebranche dessus les cours deja places. Sans ce remappage, detacher une
     * ecole viderait ses horaires a l'ecran (les SCHEDULE_SLOTS pointeraient
     * sur des creneaux qui ne font plus partie de sa grille).
     */
    static async detach(req, res) {
        const schoolId = ScheduleHoursController.#parseSchoolId(req.body.school_id ?? req.body.schoolId);
        if (!schoolId) return ScheduleHoursController.#sendError(res, "L'école est requise.", 400);

        let connection;
        try {
            connection = await pool.getConnection();
            await connection.beginTransaction();
            await SchoolController.assertOwned(connection, schoolId, req.user.id);

            const [own] = await connection.execute('SELECT id FROM SCH_HOURS WHERE school_id = ?', [schoolId]);
            if (own.length > 0) {
                await connection.rollback();
                return ScheduleHoursController.#sendError(res, 'Cette école a déjà sa propre grille.', 409);
            }

            const [shared] = await connection.execute(
                'SELECT id, libelle FROM SCH_HOURS WHERE school_id IS NULL ORDER BY libelle ASC'
            );

            const mapping = new Map(); // ancien id -> nouvel id
            for (const hour of shared) {
                const [result] = await connection.execute(
                    'INSERT INTO SCH_HOURS (libelle, school_id) VALUES (?, ?)',
                    [hour.libelle, schoolId]
                );
                mapping.set(hour.id, result.insertId);
            }

            for (const [oldId, newId] of mapping) {
                await connection.execute(`
                    UPDATE SCHEDULE_SLOTS ss
                    JOIN SCHEDULE_SETS s ON s.id = ss.schedule_set_id
                    JOIN JOURNALS j ON j.id = s.journal_id
                    SET ss.time_slot_id = ?
                    WHERE ss.time_slot_id = ? AND j.school_id = ?
                `, [newId, oldId, schoolId]);
            }

            await connection.commit();
            const { hours } = await ScheduleHoursController.resolveForSchool(pool, schoolId);
            res.json({ success: true, data: hours, message: 'Grille propre créée pour cette école.' });
        } catch (error) {
            if (connection) await connection.rollback();
            ScheduleHoursController.#sendError(res, error.status ? error.message : 'Erreur lors du détachement', error.status || 500);
        } finally {
            if (connection) connection.release();
        }
    }
}

module.exports = ScheduleHoursController;
