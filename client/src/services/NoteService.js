// client/src/services/NoteService.js
import api from '../api/axiosConfig';

/**
 * Récupère les notes d'un journal spécifique.
 * @param {number|string} journalId
 */
const getNotes = async (journalId) => {
    // On passe le journalId en paramètre de requête (query string)
    const response = await api.get('/notes', { params: { journalId } });
    return response.data;
};

/**
 * Ajoute une note à un journal spécifique.
 */
const addNote = async (journalId, text, state, date, time, location) => {
    // On inclut journal_id dans le corps de la requête
    const response = await api.post('/notes', {
        journal_id: journalId,
        text,
        state,
        date,
        time,
        location
    });
    return response.data;
};

/**
 * Met à jour une note existante.
 */
const updateNote = async (id, updatedFields) => {
    // updatedFields peut contenir text, state, date, time, location, ou journal_id
    const response = await api.put(`/notes/${id}`, updatedFields);
    return response.data;
};

/**
 * Supprime une note.
 */
const deleteNote = async (id) => {
    await api.delete(`/notes/${id}`);
    return id;
};

const NoteService = {
    getNotes,
    addNote,
    updateNote,
    deleteNote,
};

export default NoteService;