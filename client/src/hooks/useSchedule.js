// client/src/hooks/useSchedule.js
import { useState, useCallback } from 'react';
import ScheduleService from '../services/ScheduleService';

export const useSchedule = (setId) => {
    const [slots, setSlots] = useState([]);
    const [loading, setLoading] = useState(false);

    const fetchSlots = useCallback(async () => {
        if (!setId) {
            setSlots([]);
            return;
        }
        setLoading(true);
        try {
            const res = await ScheduleService.getScheduleById(setId);
            // On transforme la liste plate en objet indexé par "jour-heure"
            // pour faciliter l'accès dans le Journal
            const formatted = {};
            (res.data || []).forEach(slot => {
                formatted[`${slot.day_of_week}-${slot.time_slot_id}`] = slot;
            });
            setSlots(formatted);
        } catch (err) {
            console.error("Erreur slots:", err);
        } finally {
            setLoading(false);
        }
    }, [setId]);
    const getActiveScheduleByDate = useCallback(async (date) => {
        try {
            const res = await ScheduleService.getScheduleIdByDate(date);
            return res.id;
        } catch (err) {
            return null;
        }
    }, []);

    return { slots, loading, fetchSlots };
};