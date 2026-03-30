// client/src/services/ScheduleService.js
import axios from '../api/axiosConfig';

const ScheduleService = {
    /**
     * Récupère tous les ensembles d'horaires (modèles) disponibles.
     * Note: La route backend est préfixée par /api/schedule dans axiosConfig ou app.use
     */
    getScheduleSets: async (journalId) => {
        // On passe le journalId en paramètre de requête pour filtrer côté serveur
        const response = await axios.get(`/schedule/sets`, {
            params: { journalId }
        });
        return response.data;
    },

    /**
     * Crée un nouveau modèle d'emploi du temps (ex: "Horaire d'hiver")
     */
    // client/src/services/ScheduleService.js
    createScheduleSet: async (name, journalId, startDate, endDate) => {
        return axios.post('/schedule/sets', {
            name,
            journal_id: journalId,
            start_date: startDate,
            end_date: endDate
        });
    },

    getScheduleIdByDate: async (date) => {
        const response = await axios.get(`/schedule/active-set?date=${date}`);
        return response.data;
    },

    /**
     * Récupère les créneaux (slots) d'un horaire spécifique.
     * On passe le setId pour charger la grille correspondante.
     */
    getScheduleById: async (setId) => {
        // Si vous avez simplifié la route au dessus, l'URL devient /api/schedule/1
        const response = await axios.get(`/schedule/${setId}`);
        return response.data;
    },

    // Ajouter dans l'objet ScheduleService

    updateScheduleSet: async (setId, data) => {
        const response = await axios.put(`/schedule/sets/${setId}`, {
            name: data.name,
            start_date: data.startDate,
            end_date: data.endDate
        });
        return response.data;
    },

    deleteSlot: async (setId, day, hourId) => {
        const response = await axios.delete(`/schedule/sets/${setId}/slots/${day}/${hourId}`);
        return response.data;
    },

    duplicateScheduleSet: async (setId, newName, startDate, endDate) => {
        const response = await axios.post(`/schedule/sets/${setId}/duplicate`, {
            newName: newName,
            start_date: startDate, // Doit matcher le req.body du backend
            end_date: endDate
        });
        return response.data;
    },

    deleteScheduleSet: async (setId) => {
        const response = await axios.delete(`/schedule/sets/${setId}`);
        return response.data;
    },

    /**
     * Sauvegarde la grille complète pour un journal spécifique.
     * @param {number|string} setId - L'ID du modèle d'emploi du temps (schedule_set)
     * @param {Array} slots - Tableau d'objets { day, time_slot_id, subject, className, room }
     */
    saveSlots: async (setId, slots) => {
        const response = await axios.post('/schedule/slots/save', {
            schedule_set_id: setId,
            slots: slots
        });
        return response.data;
    }
};

export default ScheduleService;