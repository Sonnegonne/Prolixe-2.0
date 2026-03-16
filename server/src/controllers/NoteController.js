// server/src/controllers/NoteController.js
const db = require('../../config/database');

/**
 * Récupérer les notes d'un journal spécifique.
 */
const getNotes = async (req, res) => {
    // On récupère le journalId depuis les paramètres de l'URL ou la requête
    const { journalId } = req.query;

    if (!journalId) {
        return res.status(400).json({ message: "Le journalId est requis." });
    }

    try {
        const [notes] = await db.query(
            'SELECT id, text, state, date, time, location, journal_id FROM NOTE WHERE journal_id = ? ORDER BY date ASC, time ASC',
            [journalId]
        );
        res.status(200).json(notes);
    } catch (error) {
        console.error('Erreur lors de la récupération des notes:', error);
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
        const [insertResult] = await db.query(
            'INSERT INTO NOTE (text, state, date, time, location, journal_id) VALUES (?, ?, ?, ?, ?, ?)',
            [text, noteState, noteDate, noteTime, noteLocation, journal_id]
        );

        const newNoteId = insertResult.insertId;

        const [newNoteRows] = await db.query(
            'SELECT id, text, state, date, time, location, journal_id FROM NOTE WHERE id = ?',
            [newNoteId]
        );

        res.status(201).json(newNoteRows[0]);
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
        const [result] = await db.query('UPDATE NOTE SET ? WHERE id = ?', [fieldsToUpdate, id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Note non trouvée." });
        }

        const [updatedNoteRows] = await db.query(
            'SELECT id, text, state, date, time, location, journal_id FROM NOTE WHERE id = ?',
            [id]
        );

        res.status(200).json(updatedNoteRows[0]);
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
        const [result] = await db.query('DELETE FROM NOTE WHERE id = ?', [id]);

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
    createNote,
    updateNote,
    deleteNote,
};