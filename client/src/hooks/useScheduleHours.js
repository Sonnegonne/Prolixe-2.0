// frontend/src/hooks/useScheduleHours.js
//
// La grille horaire depend de l'etablissement : deux ecoles ne decoupent pas
// forcement la journee de la meme facon. Sans argument, le hook suit l'ecole
// affichee ; on peut lui en imposer une autre (ecran de reglages, import PDF).
import { useState, useEffect, useCallback } from 'react';
import ScheduleHoursService from '../services/ScheduleHoursService';
import { useSchools } from './useSchools';

export const useScheduleHours = (schoolIdOverride) => {
    const { currentSchoolId } = useSchools();
    const schoolId = schoolIdOverride !== undefined ? schoolIdOverride : currentSchoolId;

    const [hours, setHours] = useState([]);
    // `isOwn` dit si l'ecole possede sa propre grille ou si elle lit encore la
    // grille commune : l'ecran de reglages en a besoin pour proposer le
    // detachement plutot que de laisser modifier la grille de tout le monde.
    const [isOwn, setIsOwn] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Charger les créneaux horaires
    const loadHours = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);

            const response = await ScheduleHoursService.getHours(schoolId);
            setHours(response.data.data || []);
            setIsOwn(Boolean(response.data.meta?.is_own));

        } catch (err) {
            setError(err.message);
            console.error('Erreur chargement créneaux horaires:', err);
        } finally {
            setLoading(false);
        }
    }, [schoolId]);

    // Ajouter un créneau horaire
    const addHour = async (hourData) => {
        try {
            const response = await ScheduleHoursService.createHour({ school_id: schoolId, ...hourData });
            await loadHours();
            return response.data;
        } catch (err) {
            setError(err.message);
            throw err;
        }
    };

    // Modifier un créneau horaire
    const updateHour = async (id, hourData) => {
        try {
            const response = await ScheduleHoursService.updateHour(id, hourData);
            setHours(prev => prev.map(hour =>
                hour.id === id ? { ...hour, ...response.data.data } : hour
            ));
            return response.data;
        } catch (err) {
            setError(err.message);
            throw err;
        }
    };

    // Supprimer un créneau horaire
    const removeHour = async (id) => {
        try {
            await ScheduleHoursService.deleteHour(id);
            setHours(prev => prev.filter(hour => hour.id !== id));
        } catch (err) {
            setError(err.message);
            throw err;
        }
    };

    // Donne a l'ecole sa grille propre (copie de la grille commune) et
    // rebranche les cours deja poses dessus, cote serveur.
    const detachHours = async () => {
        if (!schoolId) return;
        await ScheduleHoursService.detachHours(schoolId);
        await loadHours();
    };

    // FONCTIONS UTILITAIRES POUR L'HORAIRE

    // Parser le libellé d'heure (ex: '08:25-09:15')
    const parseTimeSlot = (libelle) => {
        const [startTime, endTime] = libelle.split('-');
        return {
            start: startTime,
            end: endTime,
            duration: calculateDuration(startTime, endTime)
        };
    };

    // Calculer la durée en minutes
    const calculateDuration = (startTime, endTime) => {
        const [startHour, startMin] = startTime.split(':').map(Number);
        const [endHour, endMin] = endTime.split(':').map(Number);

        const startMinutes = startHour * 60 + startMin;
        const endMinutes = endHour * 60 + endMin;

        return endMinutes - startMinutes;
    };

    // Formater l'heure pour l'affichage (optionnel)
    const formatTimeSlot = (libelle) => {
        return libelle; // Déjà au bon format
    };

    // Valider le format d'un créneau horaire
    const validateTimeSlot = (libelle) => {
        const timeSlotRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]-([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
        return timeSlotRegex.test(libelle);
    };

    // Créer un libellé à partir d'heures de début et fin
    const createTimeSlotLabel = (startTime, endTime) => {
        return `${startTime}-${endTime}`;
    };

    // Trier les créneaux par heure de début
    const getSortedHours = () => {
        if (!Array.isArray(hours)) {
            return [];
        }

        return [...hours].sort((a, b) => {
            const aStart = a.libelle.split('-')[0];
            const bStart = b.libelle.split('-')[0];
            return aStart.localeCompare(bStart);
        });
    };

    // Obtenir les créneaux formatés pour l'horaire
    const getHoursForSchedule = () => {
        return getSortedHours().map(hour => ({
            ...hour,
            parsed: parseTimeSlot(hour.libelle),
            display: formatTimeSlot(hour.libelle)
        }));
    };

    const getHourIdByLibelle = useCallback((libelle) => {
        const hour = hours.find(h => h.libelle === libelle);
        return hour ? hour.id : null;
    }, [hours]);

    // Rechargement a chaque changement d'ecole.
    useEffect(() => {
        loadHours().then();
    }, [loadHours]);

    return {
        // Données
        hours,
        isOwn,
        schoolId,
        loading,
        error,

        // Actions CRUD
        loadHours,
        addHour,
        updateHour,
        removeHour,
        detachHours,

        // Utilitaires
        parseTimeSlot,
        calculateDuration,
        formatTimeSlot,
        validateTimeSlot,
        createTimeSlotLabel,
        getSortedHours,
        getHoursForSchedule,
        getHourIdByLibelle
    };
};
