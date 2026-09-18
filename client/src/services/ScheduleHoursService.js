import ApiService from '../api/axiosConfig';

class ScheduleHoursService {
    // Récupérer les créneaux horaires — ceux de l'école si elle est précisée,
    // sinon la grille commune.
    static async getHours(schoolId) {
        return ApiService.request({
            url: '/hours',
            method: 'GET',
            params: schoolId ? { schoolId } : undefined,
        });
    }

    // Récupérer un créneau horaire spécifique
    static async getHour(id) { // Changé de getHours à getHour
        return ApiService.request(`/hours/${id}`);
    }

    // Créer un nouveau créneau horaire
    static async createHour(hourData) {
        return ApiService.request({
            url: '/hours',
            method: 'POST',
            data: hourData,
        });
    }

    // Modifier un créneau horaire
    static async updateHour(id, hourData) {
        return ApiService.request({
            url: `/hours/${id}`,
            method: 'PUT',
            data: hourData,
        });
    }

    // Supprimer un créneau horaire
    static async deleteHour(id) {
        return ApiService.request(`/hours/${id}`, {
            method: 'DELETE',
        });
    }

    // Donner à une école sa propre grille, copiée de la grille commune.
    static async detachHours(schoolId) {
        return ApiService.request({
            url: '/hours/detach',
            method: 'POST',
            data: { school_id: schoolId },
        });
    }
}

export default ScheduleHoursService;
