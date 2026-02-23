// frontend/hooks/useSchoolYears.js
import { useState, useEffect, useCallback } from 'react';
import schoolYearService from '../services/SchoolYearService'; // Correction de la casse du nom de fichier

/**
 * Hook personnalisé pour gérer les données des années scolaires.
 * @returns {object} Un objet contenant les années scolaires, l'état de chargement, les erreurs,
 * et les fonctions pour manipuler les données.
 */
export const useSchoolYears = () => {
    const [schoolYears, setSchoolYears] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchSchoolYears = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const data = await schoolYearService.getAll();
            setSchoolYears(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    // Le useEffect charge les données au montage du composant qui utilise le hook.
    useEffect(() => {
        fetchSchoolYears();
    }, [fetchSchoolYears]);

    const addSchoolYear = async (schoolYearData) => {
        try {
            const newSchoolYear = await schoolYearService.create(schoolYearData);
            // Ajoute la nouvelle année et retrie la liste pour maintenir l'ordre
            setSchoolYears(prev =>
                [...prev, newSchoolYear].sort((a, b) => new Date(b.start_date) - new Date(a.start_date))
            );
            return newSchoolYear;
        } catch (err) {
            setError(err.message);
            throw err;
        }
    };

    const updateSchoolYear = async (id, schoolYearData) => {
        try {
            const updatedSchoolYear = await schoolYearService.update(id, schoolYearData);
            setSchoolYears(prev =>
                prev.map(sy => (sy.id === id ? updatedSchoolYear : sy))
            );
            return updatedSchoolYear;
        } catch (err) {
            setError(err.message);
            throw err;
        }
    };

    const deleteSchoolYear = async (id) => {
        try {
            await schoolYearService.remove(id);
            setSchoolYears(prev => prev.filter(sy => sy.id !== id));
        } catch (err) {
            setError(err.message);
            throw err;
        }
    };


    const getSchoolYearName = useCallback(async (id) => {
        if (!id) return '';
        try {
            const fetchedSY = await schoolYearService.getById(id);
            return fetchedSY ? fetchedSY.start_date + " - " + fetchedSY.end_date : 'Année inconnue';
        } catch (err) {
            return 'Erreur';
        }

    }, [schoolYears]); // Dépend de schoolYears pour avoir la liste la plus à jour

   /*
    const getSchoolYear = useCallback(async (id) => {
        if (!id) return null;
        try {
            setLoading(true);
            setError(null);
            return await schoolYearService.getById(id);
        } catch (err) {
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    }, []);*/

    return {
        schoolYears,
        loading,
        error,
        addSchoolYear,
        updateSchoolYear,
        deleteSchoolYear,
        getSchoolYearName,
        //getSchoolYear,
        refresh: fetchSchoolYears
    };
};
