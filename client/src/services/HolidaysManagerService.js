// client/src/services/HolidaysManagerService.js
import api from '../api/axiosConfig';

const HolidaysManagerService = {
    uploadHolidaysFile: async (formData) => {
        try {
            const response = await api.post('/holidays/upload', formData, {
                headers: {
                    'Content-Type': 'multipart/form-data',
                },
            });
            return response.data;
        } catch (error) {
            throw error;
        }
    },

    // Nouvelle méthode pour récupérer les congés d'une année spécifique
    getHolidaysByYear: async (schoolYearId) => {
        try {
            const response = await api.get(`/holidays/${schoolYearId}`);
            return response.data;
        } catch (error) {
            throw error;
        }
    },

    getHolidays: async () => {
        try {
            const response = await api.get('/holidays');
            return response.data;
        } catch (error) {
            throw error;
        }
    }
};

export default HolidaysManagerService;