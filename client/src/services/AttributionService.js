// client/src/services/AttributionService.js

import api from '../api/axiosConfig';

const AttributionService = {
    /**
     * Récupère toutes les attributions.
     * @returns {Promise<Array>} Une promesse résolue avec le tableau des attributions.
     */
    getAttributions: async () => {
        const response = await api.get('/attributions');
        return response.data;
    },

    /**
     * Sauvegarde ou met à jour une attribution.
     * @param {object} attributionData - Les données de l'attribution.
     * @returns {Promise<object>} L'attribution sauvegardée ou mise à jour.
     */
    saveAttribution: async (attributionData) => {
        if (attributionData.id) {
            // Mise à jour si l'ID existe
            const response = await api.put(`/attributions/${attributionData.id}`, attributionData);
            return response.data;
        } else {
            // Création si c'est une nouvelle attribution
            const response = await api.post('/attributions', attributionData);
            return response.data;
        }
    },

    /**
     * Supprime une attribution.
     * @param {number|string} id - L'ID de l'attribution à supprimer.
     * @returns {Promise<void>}
     */
    deleteAttribution: async (id) => {
        await api.delete(`/attributions/${id}`);
    },
};

export default AttributionService;