// client/src/hooks/useHolidays.js
import { useState, useEffect, useCallback } from 'react';
import { isWithinInterval, parseISO, endOfDay } from 'date-fns';
import { useJournal } from './useJournal';
import HolidaysManagerService from '../services/HolidaysManagerService';

export const useHolidays = () => {
    const [holidays, setHolidays] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const { currentJournal } = useJournal();

    const fetchHolidays = useCallback(async () => {
        // On vérifie que le journal actuel possède bien une année scolaire associée
        if (!currentJournal?.school_year_id) {
            setHolidays([]);
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const response = await HolidaysManagerService.getHolidaysByYear(currentJournal.school_year_id);
            if (response.success) {
                // Les données sont stockées sous forme de JSON (array) dans la colonne holidays
                setHolidays(response.data || []);
            } else {
                throw new Error(response.message || "Erreur lors de la récupération des congés");
            }
        } catch (err) {
            console.error("Erreur hook useHolidays:", err);
            setError(err.message);
            setHolidays([]);
        } finally {
            setLoading(false);
        }
    }, [currentJournal?.school_year_id]);

    useEffect(() => {
        fetchHolidays();
    }, [fetchHolidays]);

    const getHolidayForDate = useCallback((date) => {
        if (!date || !holidays || holidays.length === 0) return null;

        // On s'assure que la date passée est un objet Date
        const targetDate = date instanceof Date ? date : new Date(date);

        for (const holiday of holidays) {
            try {
                const interval = {
                    start: parseISO(holiday.start),
                    end: endOfDay(parseISO(holiday.end))
                };
                if (isWithinInterval(targetDate, interval)) {
                    return holiday;
                }
            } catch (e) {
                console.error("Format de date de congé invalide:", holiday);
                continue;
            }
        }
        return null;
    }, [holidays]);

    return {
        holidays,
        loading,
        error,
        getHolidayForDate,
        refreshHolidays: fetchHolidays
    };
};