// server/src/controllers/NoteController.js
const db = require('../../config/database');

// Une note appartient à un journal, le journal à un utilisateur : toute
// requête passe par JOURNALS.user_id. Sans cette jointure, n'importe quel
// compte connecté pouvait lire ou effacer les notes d'un autre en changeant
// l'identifiant dans l'URL.
const NOTE_COLUMNS = 'n.id, n.text, n.state, n.date, n.time, n.location, n.journal_id';

const ownsJournal = async (journalId, userId) => {
    const [rows] = await db.query('SELECT id FROM JOURNALS WHERE id = ? AND user_id = ?', [journalId, userId]);
    return rows.length > 0;
};

const findOwnedNote = async (id, userId) => {
    const [rows] = await db.query(
        `SELECT ${NOTE_COLUMNS} FROM NOTE n JOIN JOURNALS j ON j.id = n.journal_id WHERE n.id = ? AND j.user_id = ?`,
        [id, userId]
    );
    return rows[0] || null;
};

/**
 * Récupérer les notes d'un journal spécifique.
 */
const getNotes = async (req, res) => {
    const { journalId } = req.query;

    if (!journalId) {
        return res.status(400).json({ message: "Le journalId est requis." });
    }

    try {
        const [notes] = await db.query(
            `SELECT ${NOTE_COLUMNS} FROM NOTE n JOIN JOURNALS j ON j.id = n.journal_id
             WHERE n.journal_id = ? AND j.user_id = ?
             ORDER BY n.date ASC, n.time ASC`,
            [journalId, req.user.id]
        );
        res.status(200).json(notes);
    } catch (error) {
        console.error('Erreur lors de la récupération des notes:', error);
        res.status(500).json({ message: "Erreur serveur" });
    }
};

/**
 * Rendez-vous d'un jour : les notes qui portent une date ET une heure.
 *
 * Elles sont cherchées dans tous les journaux de l'utilisateur, pas seulement
 * le courant : la journée du tableau de bord montre les deux écoles, un
 * rendez-vous pris dans l'une doit y figurer même si l'autre est sélectionnée.
 */
const getAgenda = async (req, res) => {
    const { date } = req.query;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ message: "Une date AAAA-MM-JJ est requise." });
    }

    try {
        const [notes] = await db.query(
            `SELECT ${NOTE_COLUMNS},
                    s.id AS school_id, s.name AS school_name,
                    s.short_name AS school_short_name, s.color AS school_color
             FROM NOTE n
             JOIN JOURNALS j ON j.id = n.journal_id
             LEFT JOIN SCHOOLS s ON s.id = j.school_id
             WHERE j.user_id = ? AND n.date = ? AND n.time IS NOT NULL
             ORDER BY n.time ASC`,
            [req.user.id, date]
        );
        res.status(200).json(notes);
    } catch (error) {
        console.error("Erreur lors de la récupération de l'agenda:", error);
        res.status(500).json({ message: "Erreur serveur" });
    }
};

/**
 * Créer une nouvelle note liée à un journal.
 */
const createNote = async (req, res) => {
    const { text, state, date, time, location, journal_id } = req.body;

    if (!text || !journal_id) {
        return res.status(400).json({ message: "Le contenu et l'ID du journal sont requis." });
    }

    const noteState = state || 'autre';
    const noteDate = date || null;
    const noteTime = time || null;
    const noteLocation = location || null;

    try {
        if (!(await ownsJournal(journal_id, req.user.id))) {
            return res.status(404).json({ message: "Journal introuvable." });
        }

        const [insertResult] = await db.query(
            'INSERT INTO NOTE (text, state, date, time, location, journal_id) VALUES (?, ?, ?, ?, ?, ?)',
            [text, noteState, noteDate, noteTime, noteLocation, journal_id]
        );

        res.status(201).json(await findOwnedNote(insertResult.insertId, req.user.id));
    } catch (error) {
        console.error('Erreur lors de la création de la note:', error);
        res.status(500).json({ message: "Erreur serveur" });
    }
};

/**
 * Mettre à jour une note.
 */
const updateNote = async (req, res) => {
    const { id } = req.params;
    const { text, state, date, time, location, journal_id } = req.body;

    if (!text && !state && !date && !time && !location && !journal_id) {
        return res.status(400).json({ message: "Au moins un champ doit être fourni." });
    }

    const fieldsToUpdate = {};
    if (text !== undefined) fieldsToUpdate.text = text;
    if (state !== undefined) fieldsToUpdate.state = state;
    if (date !== undefined) fieldsToUpdate.date = date || null;
    if (time !== undefined) fieldsToUpdate.time = time || null;
    if (location !== undefined) fieldsToUpdate.location = location || null;
    if (journal_id !== undefined) fieldsToUpdate.journal_id = journal_id;

    try {
        if (!(await findOwnedNote(id, req.user.id))) {
            return res.status(404).json({ message: "Note non trouvée." });
        }
        if (journal_id !== undefined && !(await ownsJournal(journal_id, req.user.id))) {
            return res.status(404).json({ message: "Journal introuvable." });
        }

        await db.query('UPDATE NOTE SET ? WHERE id = ?', [fieldsToUpdate, id]);
        res.status(200).json(await findOwnedNote(id, req.user.id));
    } catch (error) {
        console.error('Erreur lors de la mise à jour de la note:', error);
        res.status(500).json({ message: "Erreur serveur" });
    }
};

/**
 * Supprimer une note.
 */
const deleteNote = async (req, res) => {
    const { id } = req.params;

    try {
        const [result] = await db.query(
            'DELETE n FROM NOTE n JOIN JOURNALS j ON j.id = n.journal_id WHERE n.id = ? AND j.user_id = ?',
            [id, req.user.id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Note non trouvée." });
        }
        res.status(200).json({ message: "Note supprimée avec succès" });
    } catch (error) {
        console.error('Erreur lors de la suppression de la note:', error);
        res.status(500).json({ message: "Erreur serveur" });
    }
};

module.exports = {
    getNotes,
    getAgenda,
    createNote,
    updateNote,
    deleteNote,
};
