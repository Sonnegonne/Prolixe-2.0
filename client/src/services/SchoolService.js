// client/src/services/SchoolService.js
import apiClient from '../api/axiosConfig';

const SchoolService = {
    getSchools: async () => {
        const response = await apiClient.get('/schools');
        return response.data;
    },

    createSchool: async (data) => {
        const response = await apiClient.post('/schools', data);
        return response.data;
    },

    updateSchool: async (id, data) => {
        const response = await apiClient.put(`/schools/${id}`, data);
        return response.data;
    },

    deleteSchool: async (id) => {
        const response = await apiClient.delete(`/schools/${id}`);
        return response.data;
    },
};

export default SchoolService;
