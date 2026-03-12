// C:/Temp/Prolixe/client/src/api/axiosConfig.js
import axios from 'axios';

const apiClient = axios.create({
    //baseURL: 'http://217.154.117.102/api',
    baseURL: 'http://localhost:5001/api'
});

// Intercepteur pour ajouter le token JWT à chaque requête
apiClient.interceptors.request.use(
    (config) => {
        // Récupère le token depuis le localStorage (ou l'endroit où vous le stockez)
        const token = localStorage.getItem('authToken') || sessionStorage.getItem('authToken');
        if (token) {
            config.headers['Authorization'] = `Bearer ${token}`;
        }
        return config;
    },
    (error) => Promise.reject(error)
);

apiClient.interceptors.response.use(
    (response) => response,
    (error) => {
        const token = localStorage.getItem('authToken') || sessionStorage.getItem('authToken');
        if ( error.response && error.response.status === 403 && token) {
            window.dispatchEvent(new Event('auth-error'));
        }
        return Promise.reject(error);
    }
);

export default apiClient;