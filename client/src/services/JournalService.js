import ApiService from '../api/axiosConfig';

const JOURNAL_API_URL = '/journal'; // Base URL pour les journaux

class JournalService {
    // --- Gestion des Journaux (Années scolaires) ---
    static async getAllJournals() {
        return ApiService.get(`${JOURNAL_API_URL}/`);
    }

    static async createJournal(data) {
        return ApiService.post(`${JOURNAL_API_URL}/`, data);
    }

    static async archiveJournal(id) {
        return ApiService.post(`${JOURNAL_API_URL}/archive/${id}`);
    }

    static async deleteJournal(id) {
        return ApiService.delete(`${JOURNAL_API_URL}/delete/${id}`);
    }

    static async getCurrentJournal() {
        return ApiService.get(`${JOURNAL_API_URL}/current`);
    }

    // --- Entrées du Journal (Notes de cours) ---
    /**
     * Récupère les notes de cours pour une période donnée.
     * Le journal_id est crucial pour isoler les données de l'année scolaire en cours.
     */
    static async getJournalEntries(startDate, endDate, journal_id) {
        return ApiService.get(`${JOURNAL_API_URL}/entries`, {
            params: { startDate, endDate, journal_id }
        });
    }

    /**
     * Sauvegarde ou met à jour une note de cours.
     * @param {Object} entryData - Doit contenir schedule_id (lié au slot_id), date, actual_work, etc.
     */
    static async upsertJournalEntry(entryData) {
        // Dans votre nouvelle logique, entryData.schedule_id correspond au slot_id reçu de l'horaire
        return ApiService.put(`${JOURNAL_API_URL}/entries`, entryData);
    }

    static async deleteJournalEntry(id) {
        return ApiService.delete(`${JOURNAL_API_URL}/entries/${id}`);
    }

    static async clearJournal(journalId) {
        return ApiService.delete(`${JOURNAL_API_URL}/entries/clear/${journalId}`);
    }

    // --- Assignations / Devoirs ---
    /**
     * Récupère les devoirs et évaluations.
     */
    static async getAssignments(journalId, classId = '', startDate = '', endDate = '') {
        if (!journalId) {
            console.error("Un ID de journal est requis pour récupérer les assignations.");
            return Promise.resolve({ data: { data: [], success: false } });
        }

        const params = { journal_id: journalId };
        if (classId) params.classId = classId;
        if (startDate) params.startDate = startDate;
        if (endDate) params.endDate = endDate;

        return ApiService.get(`${JOURNAL_API_URL}/assignments`, { params });
    }

    static async upsertAssignment(assignmentData) {
        return ApiService.put(`${JOURNAL_API_URL}/assignments`, assignmentData);
    }

    static async deleteAssignment(id) {
        return ApiService.delete(`${JOURNAL_API_URL}/assignments/${id}`);
    }

    // --- Import / Export ---
    static async importJournal(file, journalId) {
        const formData = new FormData();
        formData.append('journalFile', file);
        formData.append('journal_id', journalId);
        return ApiService.post(`${JOURNAL_API_URL}/import`, formData);
    }
}

export default JournalService;