import { useState, useCallback } from 'react';
import ScheduleService from '../services/ScheduleService';

export const useSchedule = (setId) => {
    const [slots, setSlots] = useState({});
    const [availableSets, setAvailableSets] = useState([]);
    const [loading, setLoading] = useState(false);

    // Utilisation du nom correct : getScheduleSets
    const fetchAllSets = useCallback(async (journalId) => {
        setLoading(true);
        try {
            // Appel avec le journalId requis par votre service
            const data = await ScheduleService.getScheduleSets(journalId);
            setAvailableSets(data || []);
            return data;
        } catch (err) {
            console.error("Erreur sets:", err);
            setAvailableSets([]);
            return [];
        } finally {
            setLoading(false);
        }
    }, []);

    const fetchSlots = useCallback(async () => {
        if (!setId) {
            setSlots({});
            return;
        }
        setLoading(true);
        try {
            const data = await ScheduleService.getScheduleById(setId);
            const formatted = {};
            // Votre service renvoie directement les données
            let dataConstr = data.data;

            (dataConstr || []).forEach(slot => {
                formatted[`${slot.day_of_week}-${slot.time_slot_id}`] = slot;
            });
            setSlots(formatted);
        } catch (err) {
            console.error("Erreur slots:", err);
            setSlots({});
        } finally {
            setLoading(false);
        }
    }, [setId]);

    return { slots, availableSets, loading, fetchSlots, fetchAllSets };
};