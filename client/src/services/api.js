// client/src/services/api.js

import {useAuth} from "../hooks/useAuth";

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

class ApiService {
static async request(endpoint, options = {}, requireAuth = true) {

    const url = `${API_BASE_URL}${endpoint}`;
        const config = {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers,
            },
        };

        if (requireAuth) {
            const token = localStorage.getItem('authToken') || sessionStorage.getItem('authToken');
            if (token) {
                config.headers['Authorization'] = `Bearer ${token}`;
            } else {
                throw new Error('Authentication token not found.');
            }
        }


        try {
            const response = await fetch(url, config);
            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    window.dispatchEvent(new Event('auth-error'));
                }
                const data = await response.json();
                throw new Error(data.message || `HTTP error! status: ${response.status}`);
            }

            if (response.status === 204) {
                return { success: true };
            }

            return await response.json();

        } catch (error) {
            console.error('❌ API Error:', error);
            throw error;
        }
    }
}

export default ApiService;