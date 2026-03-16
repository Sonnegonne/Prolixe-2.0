// client/src/hooks/useScheduleModel.js

import { useState, useEffect, useCallback } from 'react';
import ScheduleModelService from '../services/ScheduleModelService';

const useScheduleModel = (journalId) => {
    const [schedules, setSchedules] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const fetchSchedules = useCallback(async () => {
        if (!journalId) return;
        setLoading(true);
        setError(null);
        try {
            const response = await ScheduleModelService.getSchedules(journalId);
            setSchedules(response.data.data || []);
        } catch (err) {
            const errorMessage = err.response?.data?.message || err.message || 'Erreur lors de la récupération';
            setError(errorMessage);
        } finally {
            setLoading(false);
        }
    }, [journalId]);

    const createSchedule = useCallback(async (scheduleData) => {
        if (!journalId) throw new Error("Aucun journal sélectionné.");
        setLoading(true);
        setError(null);
        try {
            await ScheduleModelService.createSchedule(
                scheduleData.name,
                scheduleData.startDate,
                scheduleData.endDate,
                journalId  // journalId correctement transmis
            );
            await fetchSchedules();
        } catch (err) {
            const errorMessage = err.response?.data?.message || err.message || 'Erreur lors de la création';
            setError(errorMessage);
            throw new Error(errorMessage);
        } finally {
            setLoading(false);
        }
    }, [journalId, fetchSchedules]);

    const deleteSchedule = useCallback(async (scheduleSetId) => {
        setLoading(true);
        setError(null);
        try {
            await ScheduleModelService.deleteSchedule(scheduleSetId);
            await fetchSchedules();
        } catch (err) {
            const errorMessage = err.response?.data?.message || err.message || 'Erreur lors de la suppression';
            setError(errorMessage);
            throw new Error(errorMessage);
        } finally {
            setLoading(false);
        }
    }, [fetchSchedules]);

    const duplicateSchedule = useCallback(async (scheduleSetId, newName) => {
        setLoading(true);
        setError(null);
        try {
            await ScheduleModelService.duplicateSchedule(scheduleSetId, newName);
            await fetchSchedules();
        } catch (err) {
            const errorMessage = err.response?.data?.message || err.message || 'Erreur lors de la duplication';
            setError(errorMessage);
            throw new Error(errorMessage);
        } finally {
            setLoading(false);
        }
    }, [fetchSchedules]);

    useEffect(() => {
        fetchSchedules();
    }, [fetchSchedules]);

    return { schedules, loading, error, createSchedule, deleteSchedule, duplicateSchedule, fetchSchedules };
};

export default useScheduleModel;