import ApiService from '../api/axiosConfig';

const JOURNAL_API_URL = '/journal';

/**
 * Service gérant les communications API pour le journal de classe.
 * Note : journal_id fait référence à l'entité "Année Scolaire / Carnet"
 * tandis que schedule_id (ou slot_id) fait référence à la structure de l'horaire.
 */
class JournalService {

    // ==========================================
    // --- GESTION DES JOURNAUX (Entités) ---
    // ==========================================

    static async getAllJournals() {
        return ApiService.get(`${JOURNAL_API_URL}/`);
    }

    static async getCurrentJournal() {
        return ApiService.get(`${JOURNAL_API_URL}/current`);
    }

    static async createJournal(data) {
        return ApiService.post(`${JOURNAL_API_URL}/`, data);
    }

    static async archiveJournal(id) {
        // Souvent traité comme un PATCH ou un POST sur une action spécifique
        return ApiService.post(`${JOURNAL_API_URL}/${id}/archive`);
    }

    static async deleteJournal(id) {
        return ApiService.delete(`${JOURNAL_API_URL}/${id}`);
    }

    // ==========================================
    // --- SESSIONS & ENTRÉES DU JOURNAL ---
    // ==========================================

    /**
     * RÉCUPÈRE LES SESSIONS (Utilisé par JournalView)
     * Combine les slots de l'horaire et le contenu du journal.
     */
    static async getSessions(journal_id, startDate, endDate) {
        const response = await ApiService.get(`${JOURNAL_API_URL}/sessions`, {
            params: { journal_id, startDate, endDate }
        });
        return response.data?.data || response.data || [];
    }

    /**
     * Récupère les entrées brutes du journal.
     */
    static async getJournalEntries(startDate, endDate, journal_id) {
        return ApiService.get(`${JOURNAL_API_URL}/entries`, {
            params: { startDate, endDate, journal_id }
        });
    }

    /**
     * Sauvegarde ou met à jour une note de cours (Upsert).
     * @param {Object} mappedData - Données déjà mappées par le hook (entry_date, content_planned, etc.)
     */
    static async upsertJournalEntry(mappedData) {
        return ApiService.put(`${JOURNAL_API_URL}/entries`, mappedData);
    }

    static async deleteJournalEntry(id) {
        return ApiService.delete(`${JOURNAL_API_URL}/entries/${id}`);
    }

    static async clearJournal(journalId) {
        return ApiService.delete(`${JOURNAL_API_URL}/entries/clear/${journalId}`);
    }

    // ==========================================
    // --- ASSIGNATIONS / DEVOIRS ---
    // ==========================================

    /**
     * Récupère les devoirs et évaluations.
     */
    static async getAssignments(journalId, startDate = null, endDate = null) {
        if (!journalId) throw new Error("journal_id est requis");

        const params = { journal_id: journalId };
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

    // ==========================================
    // --- IMPORT / EXPORT ---
    // ==========================================

    static async importJournal(file, journalId) {
        const formData = new FormData();
        formData.append('journalFile', file);
        formData.append('journal_id', journalId);

        return ApiService.post(`${JOURNAL_API_URL}/import`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });
    }

    static async exportJournal(id, fileName = 'export_journal.json') {
        const response = await ApiService.get(`${JOURNAL_API_URL}/${id}/export`, {
            responseType: 'blob' // Indispensable pour traiter le fichier binaire
        });

        const url = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', fileName);
        document.body.appendChild(link);
        link.click();

        link.parentNode.removeChild(link);
        window.URL.revokeObjectURL(url);
    }
}

export default JournalService;