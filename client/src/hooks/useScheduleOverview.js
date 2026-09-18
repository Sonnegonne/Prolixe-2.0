// client/src/hooks/useScheduleOverview.js
//
// Semaine « toutes écoles » d'une date donnée.
//
// Une enseignante n'a qu'une semaine, même partagée entre deux
// établissements : l'emploi du temps et la journée du tableau de bord doivent
// pouvoir les montrer ensemble. Le reste de l'application (journal, classes,
// évaluations) reste cloisonné par école.
//
// La fusion se fait ici, sur le **libellé** du créneau et non sur son id :
// chaque école a sa propre grille horaire, donc deux « 08:25-09:15 » portent
// deux identifiants différents. Deux écoles qui partagent le même découpage se
// retrouvent donc sur la même ligne, et une école décalée ajoute les siennes.
import { useState, useEffect, useCallback, useMemo } from 'react';
import ScheduleService from '../services/ScheduleService';
import { useAuth } from './useAuth';

// « 8:30-9:20 » comme « 08:30-09:20 » : on compare des minutes, jamais du
// texte, sinon 10:00 passerait avant 8:30.
export const startMinutes = (libelle) => {
    const [h, m] = String(libelle || '').split('-')[0].split(':');
    const minutes = Number(h) * 60 + Number(m);
    return Number.isFinite(minutes) ? minutes : Number.MAX_SAFE_INTEGER;
};

export const useScheduleOverview = (date) => {
    const { isAuthenticated } = useAuth();
    const [entries, setEntries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const load = useCallback(async () => {
        if (!date) return;
        setLoading(true);
        try {
            const response = await ScheduleService.getOverview(date);
            setEntries(response.data || []);
            setError(null);
        } catch (err) {
            setError(err.message || "Erreur lors du chargement des horaires.");
            setEntries([]);
        } finally {
            setLoading(false);
        }
    }, [date]);

    useEffect(() => {
        if (isAuthenticated) load();
    }, [isAuthenticated, load]);

    // Tous les cours, chacun sachant de quelle école il vient.
    const courses = useMemo(() => entries.flatMap(entry =>
        (entry.slots || []).map(slot => ({
            ...slot,
            school: entry.school,
            school_id: entry.school.id,
            journal_id: entry.set?.journal_id || null,
            set_id: entry.set?.id || null,
        }))
    ), [entries]);

    // Lignes de la grille : union des créneaux de toutes les écoles.
    const rows = useMemo(() => {
        const byLibelle = new Map();
        for (const entry of entries) {
            for (const hour of entry.hours || []) {
                if (!byLibelle.has(hour.libelle)) {
                    byLibelle.set(hour.libelle, {
                        libelle: hour.libelle,
                        start: startMinutes(hour.libelle),
                        schoolIds: new Set(),
                    });
                }
                byLibelle.get(hour.libelle).schoolIds.add(entry.school.id);
            }
        }
        return [...byLibelle.values()]
            .sort((a, b) => a.start - b.start)
            .map(row => ({ ...row, schoolIds: [...row.schoolIds] }));
    }, [entries]);

    // (jour, libellé) -> cours. Un tableau, car rien n'interdit deux cours
    // simultanés dans deux écoles : mieux vaut les montrer que d'en cacher un.
    const coursesByCell = useMemo(() => {
        const map = new Map();
        for (const course of courses) {
            const key = `${course.day_of_week}-${course.time_label}`;
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(course);
        }
        return map;
    }, [courses]);

    const getCell = useCallback(
        (dayId, libelle) => coursesByCell.get(`${dayId}-${libelle}`) || [],
        [coursesByCell]
    );

    const coursesForDay = useCallback((dayId) =>
        courses
            .filter(course => parseInt(course.day_of_week, 10) === dayId)
            .sort((a, b) => startMinutes(a.time_label) - startMinutes(b.time_label)),
        [courses]
    );

    return { entries, courses, rows, getCell, coursesForDay, loading, error, reload: load };
};
