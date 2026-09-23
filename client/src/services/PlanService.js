import ApiService from '../api/axiosConfig';
const PLAN_API_URL = '/plans';

// Couche axios : le corps est sous `response.data`, et le plan lui-même sous
// `response.data.data` ({ layout, version, updated_at } ou null).
class PlanService {
    static async getPlan(classId) {
        return ApiService.get(`${PLAN_API_URL}/${classId}`);
    }

    /**
     * @param {number} version - version chargée depuis le serveur (0 si aucune).
     * Une version dépassée renvoie une erreur 409 dont
     * `error.response.data.data` contient le plan enregistré par l'autre poste.
     */
    static async savePlan(classId, layout, version) {
        return ApiService.put(`${PLAN_API_URL}/${classId}`, { layout, version });
    }
}

export default PlanService;
