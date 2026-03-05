import ApiService from '../api/axiosConfig';

const EVALUATION_API_URL = '/evaluations';

export const getEvaluations = (journalId) => {
    if (!journalId) return Promise.resolve({ data: [] });
    return ApiService.get(`${EVALUATION_API_URL}`, { params: { journalId } });
};

export const getEvaluationById = (id) => {
    return ApiService.get(`${EVALUATION_API_URL}/${id}`);
};

export const createEvaluation = (evaluationData) => {
    return ApiService.post(`${EVALUATION_API_URL}`, evaluationData);
};

export const updateEvaluation = (id, evaluationData) => {
    return ApiService.put(`${EVALUATION_API_URL}/${id}`, evaluationData);
};

export const deleteEvaluation = (id) => {
    return ApiService.delete(`${EVALUATION_API_URL}/${id}`);
};

export const getEvaluationForGrading = (id) => {
    return ApiService.get(`${EVALUATION_API_URL}/${id}/grading`);
};

export const saveGrades = (evaluationId, studentGrades, status = { is_completed: true, is_corrected: true }) => {
    return ApiService.post(`${EVALUATION_API_URL}/${evaluationId}/grades`, {
        studentGrades,
        ...status
    });
};

export const getEvaluationTemplates = () => {
    return ApiService.get(`${EVALUATION_API_URL}/templates`);
};
