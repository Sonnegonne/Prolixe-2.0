// client/src/services/ScheduleModelService.js
import apiClient from '../api/axiosConfig';

const ScheduleModelService = {
    /**
     * Récupère tous les ensembles d'horaires pour un journal donné.
     */
    getSchedules: (journalId) => {
        return apiClient.get('/schedule/sets', {
            params: { journal_id: journalId }
        });
    },

    /**
     * Crée un nouvel ensemble d'horaires lié à un journal.
     */
    createSchedule: (name, startDate, endDate, journalId) => {
        return apiClient.post('/schedule/sets', {
            name,
            start_date: startDate,
            end_date: endDate,
            journal_id: journalId
        });
    },

    /**
     * Supprime un ensemble d'horaires.
     */
    deleteSchedule: (scheduleSetId) => {
        return apiClient.delete(`/schedule/sets/${scheduleSetId}`);
    },

    /**
     * Duplique un ensemble d'horaires existant.
     */
    duplicateSchedule: (scheduleSetId, newName) => {
        return apiClient.post(`/schedule/sets/${scheduleSetId}/duplicate`, { newName });
    }
};

export default ScheduleModelService;