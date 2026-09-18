// backend/controllers/ScheduleController.js
const pool = require('../../config/database');
const SchoolController = require('./SchoolController');
const ScheduleHoursController = require('./ScheduleHoursController');

class ScheduleController {

    // Vue « toutes ecoles » d'une date donnee.
    //
    // L'enseignante n'a qu'une semaine, meme si elle a deux etablissements :
    // le tableau de bord et l'emploi du temps doivent pouvoir montrer les deux
    // d'un coup. Le reste de l'application (journal, classes, evaluations)
    // continue de travailler ecole par ecole via le journal courant.
    //
    // Chaque ecole apporte son propre horaire actif a cette date ET sa propre
    // grille horaire : c'est le client qui fusionne les lignes par libelle,
    // parce que lui seul sait s'il affiche une grille ou une liste.
    static async getOverview(req, res) {
        const { date } = req.query;
        const userId = req.user.id;

        if (!date) {
            return res.status(400).json({ success: false, message: 'La date est requise.' });
        }

        try {
            const schools = await SchoolController.listForUser(pool, userId);
            const payload = [];

            for (const school of schools) {
                // Meme regle de depart que getScheduleByDate : parmi les
                // horaires valides ce jour-la, le dernier entre en vigueur
                // l'emporte. On ignore les journaux archives, dont l'horaire
                // ferait double emploi avec celui de l'annee en cours.
                const [sets] = await pool.execute(`
                    SELECT s.id, s.name, s.journal_id, j.name AS journal_name
                    FROM SCHEDULE_SETS s
                    JOIN JOURNALS j ON j.id = s.journal_id
                    WHERE s.user_id = ?
                      AND j.school_id = ?
                      AND j.is_archived = 0
                      AND ? BETWEEN DATE(s.start_time) AND DATE(s.end_time)
                    ORDER BY s.start_time DESC, s.id DESC
                    LIMIT 1
                `, [userId, school.id, date]);

                const { hours } = await ScheduleHoursController.resolveForSchool(pool, school.id);
                let slots = [];

                if (sets.length > 0) {
                    const [rows] = await pool.execute(`
                        SELECT
                            ss.id AS slot_id,
                            ss.day_of_week,
                            ss.time_slot_id,
                            ss.room,
                            ss.class_id,
                            ss.subject_id,
                            sh.libelle AS time_label,
                            c.name AS class_name,
                            c.level AS class_level,
                            sbj.name AS subject_name,
                            sbj.color_code AS subject_color
                        FROM SCHEDULE_SLOTS ss
                            LEFT JOIN SCH_HOURS sh ON ss.time_slot_id = sh.id
                            LEFT JOIN CLASSES c ON ss.class_id = c.id
                            LEFT JOIN SUBJECTS sbj ON ss.subject_id = sbj.id
                        WHERE ss.schedule_set_id = ?
                        ORDER BY ss.day_of_week ASC
                    `, [sets[0].id]);
                    slots = rows;
                }

                payload.push({
                    school: {
                        id: school.id,
                        name: school.name,
                        short_name: school.short_name,
                        color: school.color
                    },
                    set: sets[0] || null,
                    hours,
                    slots
                });
            }

            res.json({ success: true, data: payload });
        } catch (error) {
            console.error('Erreur getOverview:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    }

    static async createScheduleSet(req, res) {
        const { name, journal_id, start_date, end_date } = req.body;
        const userId = req.user.id;

        if (!name || !journal_id || !start_date || !end_date) {
            return res.status(400).json({
                success: false,
                message: "Le nom, l'ID du journal et les dates de validité sont requis."
            });
        }

        try {
            const [result] = await pool.execute(
                'INSERT INTO SCHEDULE_SETS (user_id, journal_id, name, start_time, end_time) VALUES (?, ?, ?, ?, ?)',
                [userId, journal_id, name, start_date, end_date]
            );
            res.status(201).json({ success: true, id: result.insertId, name });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    // Quel horaire fait foi a une date donnee ?
    //
    // Rien n'empeche deux modeles de couvrir la meme date : importer un nouvel
    // horaire sans cloturer le precedent suffit. Sans tri, le `LIMIT 1` renvoyait
    // alors l'un ou l'autre au gre de MySQL — en pratique le plus ancien, si bien
    // que le journal continuait d'afficher l'horaire remplace. La regle est
    // desormais explicite : parmi les modeles valides ce jour-la, celui entre en
    // vigueur le plus tard l'emporte ; a egalite, le plus recemment cree.
    // `client/src/utils/scheduleSets.js` applique exactement la meme regle.
    static async getScheduleByDate(req, res) {
        const { date, journalId } = req.query;
        const userId = req.user.id;

        if (!date) {
            return res.status(400).json({ success: false, message: 'La date est requise.' });
        }

        try {
            // DATE() : les colonnes peuvent etre des DATETIME, sans quoi le
            // dernier jour de validite serait exclu.
            let sql = `SELECT id, name FROM SCHEDULE_SETS
                       WHERE user_id = ?
                         AND ? BETWEEN DATE(start_time) AND DATE(end_time)`;
            const params = [userId, date];

            if (journalId) {
                sql += ' AND journal_id = ?';
                params.push(journalId);
            }
            sql += ' ORDER BY start_time DESC, id DESC LIMIT 1';

            const [rows] = await pool.execute(sql, params);

            if (rows.length === 0) {
                return res.json({ success: true, id: null });
            }
            res.json({ success: true, id: rows[0].id, name: rows[0].name });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    static async getJournalSchedules(req, res) {
        const userId = req.user.id;
        const { journalId } = req.query;

        if (!journalId) {
            return res.status(400).json({
                success: false,
                message: "L'ID du journal est requis pour récupérer les emplois du temps."
            });
        }

        try {
            const [rows] = await pool.execute(
                `SELECT * FROM SCHEDULE_SETS
                 WHERE user_id = ? AND journal_id = ?
                 ORDER BY start_time ASC, id ASC`,
                [userId, journalId]
            );
            res.json({ success: true, data: rows });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message || 'Erreur lors de la récupération des emplois du temps' });
        }
    }

    static async saveSlots(req, res) {
        const { schedule_set_id, slots } = req.body;
        let connection;

        if (!schedule_set_id) {
            return res.status(400).json({ success: false, message: "ID de l'ensemble d'horaires manquant." });
        }

        try {
            connection = await pool.getConnection();
            await connection.beginTransaction();

            // Suppression des anciens créneaux pour ce set
            await connection.execute(
                'DELETE FROM SCHEDULE_SLOTS WHERE schedule_set_id = ?',
                [schedule_set_id]
            );

            if (slots && slots.length > 0) {
                // Préparation des données avec les nouvelles FK
                const values = slots.map(s => [
                    schedule_set_id,
                    s.day_of_week,
                    s.time_slot_id,
                    s.class_id || null,   // Nouvelle colonne
                    s.subject_id || null, // Nouvelle colonne
                    s.room || null
                ]);

                // Insertion en masse
                await connection.query(
                    'INSERT INTO SCHEDULE_SLOTS (schedule_set_id, day_of_week, time_slot_id, class_id, subject_id, room) VALUES ?',
                    [values]
                );
            }

            await connection.commit();
            res.json({ success: true, message: "Emploi du temps sauvegardé avec succès." });

        } catch (error) {
            if (connection) await connection.rollback();
            console.error("Erreur saveSlots:", error);
            res.status(500).json({ success: false, message: "Erreur lors de la sauvegarde des créneaux", error: error.message });
        } finally {
            if (connection) connection.release();
        }
    }


    static async getFullSchedule(req, res) {
        const { id } = req.params;
        const userId = req.user.id;

        try {
            const [sets] = await pool.execute(
                'SELECT id, name, journal_id, start_time, end_time FROM SCHEDULE_SETS WHERE id = ? AND user_id = ?',
                [id, userId]
            );

            if (sets.length === 0) {
                console.log(`Accès refusé ou set inconnu : ID ${id} pour User ${userId}`);
                return res.status(404).json({
                    success: false,
                    message: "Emploi du temps non trouvé ou vous n'avez pas les droits."
                });
            }

            const [rows] = await pool.execute(`
                SELECT
                    ss.id as slot_id,
                    ss.day_of_week,
                    ss.time_slot_id,
                    ss.room,
                    ss.class_id,
                    ss.subject_id,
                    sh.libelle as time_label,
                    c.name as class_name,
                    c.level as class_level,
                    sbj.name as subject_name,
                    sbj.color_code as subject_color
                FROM SCHEDULE_SLOTS ss
                         LEFT JOIN SCH_HOURS sh ON ss.time_slot_id = sh.id
                         LEFT JOIN CLASSES c ON ss.class_id = c.id
                         LEFT JOIN SUBJECTS sbj ON ss.subject_id = sbj.id
                WHERE ss.schedule_set_id = ?
                ORDER BY ss.day_of_week ASC
            `, [id]);

            // 3. Réponse structurée
            res.json({
                success: true,
                metadata: sets[0], // Contient l'id, le nom et le journal_id du set
                data: rows         // La liste des créneaux
            });

        } catch (error) {
            console.error("Erreur critique getFullSchedule:", error);
            res.status(500).json({
                success: false,
                message: "Erreur lors de la récupération des données",
                error: error.message
            });
        }
    }

    // Ajouter ces deux méthodes statiques dans la classe ScheduleController

    static async updateScheduleSet(req, res) {
        const { id } = req.params;
        const { name, start_date, end_date } = req.body;
        const userId = req.user.id;

        try {
            await pool.execute(
                'UPDATE SCHEDULE_SETS SET name = ?, start_time = ?, end_time = ? WHERE id = ? AND user_id = ?',
                [name, start_date, end_date, id, userId]
            );
            res.json({ success: true, message: "Modèle mis à jour" });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    static async deleteSlot(req, res) {
        const { setId, day, hourId } = req.params;
        const userId = req.user.id;

        try {
            // Vérification de propriété par jointure
            await pool.execute(`
            DELETE ss FROM SCHEDULE_SLOTS ss
            JOIN SCHEDULE_SETS s SET ON ss.schedule_set_id = s.id
            WHERE ss.schedule_set_id = ? AND ss.day_of_week = ? 
            AND ss.time_slot_id = ? AND s.user_id = ?`,
                [setId, day, hourId, userId]
            );
            res.json({ success: true, message: "Cours supprimé" });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    // server/src/controllers/ScheduleController.js

    static async duplicateScheduleSet(req, res) {
        const { id } = req.params; // ID de l'horaire à copier
        const { newName, start_date, end_date } = req.body;
        const userId = req.user.id;
        let connection;

        try {
            connection = await pool.getConnection();
            await connection.beginTransaction();

            // 1. Récupérer l'ancien set pour avoir le journal_id
            const [oldSets] = await connection.execute(
                'SELECT journal_id FROM SCHEDULE_SETS WHERE id = ? AND user_id = ?',
                [id, userId]
            );

            if (oldSets.length === 0) {
                await connection.rollback();
                return res.status(404).json({ success: false, message: "Horaire original non trouvé." });
            }

            const journalId = oldSets[0].journal_id;

            // 2. Créer le nouveau set
            const [result] = await connection.execute(
                'INSERT INTO SCHEDULE_SETS (user_id, journal_id, name, start_time, end_time) VALUES (?, ?, ?, ?, ?)',
                [userId, journalId, newName, start_date, end_date]
            );
            const newSetId = result.insertId;

            // 3. Copier les créneaux (slots)
            await connection.execute(`
            INSERT INTO SCHEDULE_SLOTS (schedule_set_id, day_of_week, time_slot_id, class_id, subject_id, room)
            SELECT ?, day_of_week, time_slot_id, class_id, subject_id, room
            FROM SCHEDULE_SLOTS
            WHERE schedule_set_id = ?
        `, [newSetId, id]);

            await connection.commit();
            res.status(201).json({ success: true, id: newSetId, name: newName });

        } catch (error) {
            if (connection) await connection.rollback();
            res.status(500).json({ success: false, message: error.message });
        } finally {
            if (connection) connection.release();
        }
    }

    // server/src/controllers/ScheduleController.js

    static async deleteScheduleSet(req, res) {
        const { id } = req.params;
        const userId = req.user.id;
        let connection;

        try {
            connection = await pool.getConnection();
            await connection.beginTransaction();

            // 1. Vérifier que l'horaire appartient bien à l'utilisateur
            const [sets] = await connection.execute(
                'SELECT id FROM SCHEDULE_SETS WHERE id = ? AND user_id = ?',
                [id, userId]
            );

            if (sets.length === 0) {
                await connection.rollback();
                return res.status(404).json({ success: false, message: "Horaire non trouvé ou accès refusé." });
            }

            // 2. Supprimer les créneaux (slots) associés
            await connection.execute(
                'DELETE FROM SCHEDULE_SLOTS WHERE schedule_set_id = ?',
                [id]
            );

            // 3. Supprimer le set lui-même
            await connection.execute(
                'DELETE FROM SCHEDULE_SETS WHERE id = ?',
                [id]
            );

            await connection.commit();
            res.json({ success: true, message: "Emploi du temps supprimé avec succès." });

        } catch (error) {
            if (connection) await connection.rollback();
            res.status(500).json({ success: false, message: error.message });
        } finally {
            if (connection) connection.release();
        }
    }

}

module.exports = ScheduleController;