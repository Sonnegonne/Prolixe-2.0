import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useClasses } from '../../hooks/useClasses';
import { useJournal } from '../../hooks/useJournal';
import { useSchools } from '../../hooks/useSchools';
import { useHolidays } from '../../hooks/useHolidays';
import { useScheduleOverview } from '../../hooks/useScheduleOverview';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import JournalService from '../../services/JournalService';
import NoteService from '../../services/NoteService';

import './dashboard.scss';
import NoteSection from './NoteSection';
import TodayScheduleSection from './TodayScheduleSection';

const Dashboard = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const {
        currentJournal,
        journals,
        selectJournal,
        loadAllJournals,
        loading: loadingJournal
    } = useJournal();
    const { hasMultipleSchools, selectSchool } = useSchools();

    const journalId = currentJournal?.id;
    const today = useMemo(() => new Date(), []);
    const todayStr = format(today, 'yyyy-MM-dd');

    const { classes, loading: loadingClasses } = useClasses(journalId);
    const { getHolidayForDate, loading: loadingHolidays } = useHolidays();

    // La journée affichée couvre TOUTES les écoles : une enseignante qui
    // enseigne dans deux établissements veut sa journée d'un bloc, pas deux
    // écrans à comparer. Le reste (journal, classes) reste par école.
    const overview = useScheduleOverview(todayStr);

    // Entrées de journal et devoirs des journaux effectivement concernés
    // aujourd'hui — un par école, tels que l'horaire les a désignés.
    const activeJournalIds = useMemo(() => {
        const ids = overview.entries.map(e => e.set?.journal_id).filter(Boolean);
        if (journalId && !ids.includes(journalId)) ids.push(journalId);
        return ids;
    }, [overview.entries, journalId]);

    const [entriesOfDay, setEntriesOfDay] = useState([]);
    const [assignments, setAssignments] = useState([]);

    const loadJournalData = useCallback(async () => {
        if (activeJournalIds.length === 0) {
            setEntriesOfDay([]);
            setAssignments([]);
            return;
        }
        const results = await Promise.all(activeJournalIds.map(async (id) => {
            const [entries, works] = await Promise.all([
                JournalService.getJournalEntries(todayStr, todayStr, id).catch(() => null),
                JournalService.getAssignments(id).catch(() => null),
            ]);
            return {
                entries: entries?.data?.data || [],
                assignments: works?.data?.data || [],
            };
        }));
        setEntriesOfDay(results.flatMap(r => r.entries));
        setAssignments(results.flatMap(r => r.assignments));
    }, [activeJournalIds, todayStr]);

    useEffect(() => { loadJournalData(); }, [loadJournalData]);

    useEffect(() => { loadAllJournals(); }, [loadAllJournals]);

    // Une note qui porte une date ET une heure est un rendez-vous : celles
    // d'aujourd'hui rejoignent la journée, toutes écoles confondues. Elles
    // sont rechargées à chaque ajout/modification dans « Notes & Tâches ».
    const [appointments, setAppointments] = useState([]);
    const loadAppointments = useCallback(async () => {
        try {
            setAppointments(await NoteService.getAgenda(todayStr));
        } catch (error) {
            console.error('Erreur agenda:', error);
            setAppointments([]);
        }
    }, [todayStr]);

    useEffect(() => { loadAppointments(); }, [loadAppointments]);

    const holidayInfo = getHolidayForDate(today);

    const todaySchedule = useMemo(() => {
        if (holidayInfo) return [];
        const dayIndex = today.getDay(); // 1=Lundi…

        return overview.coursesForDay(dayIndex).map(course => {
            const journalEntry = entriesOfDay.find(entry =>
                String(entry.schedule_slot_id) === String(course.slot_id) &&
                String(entry.entry_date || '').split('T')[0] === todayStr
            );
            // Le backend nomme les colonnes content_done / content_planned ;
            // le reste de l'interface parle d'actual_work / planned_work.
            const actualWork = journalEntry?.content_done ?? journalEntry?.actual_work;
            const plannedWork = journalEntry?.content_planned ?? journalEntry?.planned_work;

            return {
                ...course,
                journalEntry: journalEntry
                    ? { ...journalEntry, actual_work: actualWork, planned_work: plannedWork }
                    : undefined,
                isCancelled: actualWork === '[CANCELLED]',
                isExam: actualWork === '[EXAM]',
                isHoliday: actualWork === '[HOLIDAY]',
                isInterro: Boolean(actualWork?.startsWith('[INTERRO]')),
            };
        });
    }, [overview, entriesOfDay, todayStr, holidayInfo, today]);

    // Cliquer un cours ouvre le journal de SON école : sans cette bascule, un
    // cours de l'autre établissement renverrait vers le mauvais journal.
    const handleSlotClick = (course) => {
        if (course.school_id) selectSchool(course.school_id);
        const target = journals.find(j => j.id === course.journal_id);
        if (target && target.id !== journalId) selectJournal(target);

        navigate('/journal', {
            state: {
                weekDate: todayStr,
                openSlotId: course.slot_id || course.id
            }
        });
    };

    const stats = useMemo(() => {
        const safeAssignments = Array.isArray(assignments) ? assignments : [];

        // Devoirs à venir (non complétés)
        const upcoming = safeAssignments.filter(a => !a.is_completed);

        // Devoirs remis mais pas encore corrigés
        const waiting = safeAssignments.filter(a => a.is_completed && !a.is_corrected);

        return [
            { title: 'Heures par semaine', value: overview.courses.length, icon: '🏫', color: 'primary' },
            { title: 'Cours aujourd\'hui', value: todaySchedule.length, icon: '📚', color: 'info' },
            { title: "Rendez-vous aujourd'hui", value: appointments.length, icon: '📅', color: 'violet' },
            { title: 'Evaluations prévues', value: upcoming.length, icon: '📝', color: 'warning' },
            { title: 'Corrections en attente', value: waiting.length, icon: '✅', color: 'success' }
        ];
    }, [overview.courses, todaySchedule, assignments, appointments]);

    const isLoading = loadingClasses || loadingJournal || overview.loading || loadingHolidays;

    if (!user) return <div className="loading-message">Chargement...</div>;

    return (
        <div className="dashboard-page">
            <div className="dashboard-header">
                <h1>DACH-GPT | {user.firstname}</h1>
            </div>

            <div className="dashboard-content">
                <div className="dashboard-columns">
                    <div className="column main-column">
                        <TodayScheduleSection
                            todaySchedule={todaySchedule}
                            appointments={appointments}
                            holidayInfo={holidayInfo}
                            classes={classes}
                            showSchools={hasMultipleSchools}
                            loading={isLoading && todaySchedule.length === 0}
                            onSlotClick={handleSlotClick}
                        />
                    </div>
                    <div className="column side-column">
                        <NoteSection onChange={loadAppointments} />
                    </div>
                </div>
            </div>
            {/* Stats Grid */}
            <div className="stats-grid">
                {stats.map((stat, index) => (
                    <div key={index} className={`stat-card ${stat.color}`}>
                        <div className="stat-icon">{stat.icon}</div>
                        <div className="stat-info">
                            <span className="stat-value">{stat.value}</span>
                            <span className="stat-label">{stat.title}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default Dashboard;
