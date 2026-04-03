import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useClasses } from '../../hooks/useClasses';
import { useJournal } from '../../hooks/useJournal';
import { useSchedule } from '../../hooks/useSchedule';
import { useHolidays } from '../../hooks/useHolidays';
import { useScheduleHours } from '../../hooks/useScheduleHours';
import { format, parseISO, isWithinInterval } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';

import './dashboard.scss';
import './dashboard_mobile.scss';
import NoteSection from './NoteSection';
import TodayScheduleSection from './TodayScheduleSection';

const Dashboard = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const {
        currentJournal,
        assignments,
        fetchAssignments,
        journalEntries,
        fetchJournalEntries,
        loadAllJournals,
        loading: loadingJournal
    } = useJournal();

    const journalId = currentJournal?.id;
    const today = useMemo(() => new Date(), []);
    const todayStr = format(today, 'yyyy-MM-dd');

    const { classes, loading: loadingClasses, getClassColor } = useClasses(journalId);
    const { getHolidayForDate, loading: loadingHolidays } = useHolidays();
    const { hours, loading: loadingHours } = useScheduleHours();

    // Logique d'horaire
    const [activeSetId, setActiveSetId] = useState(null);
    const { slots, availableSets, schedule, loading: loadingSlots, fetchSlots, fetchAllSets } = useSchedule(activeSetId);

    useEffect(() => {
        if (journalId) {
            fetchAllSets(journalId);
            loadAllJournals();
        }
    }, [journalId, fetchAllSets, loadAllJournals]);

    useEffect(() => {
        const sets = Array.isArray(availableSets) ? availableSets : (availableSets?.data || []);
        if (sets.length > 0) {
            const currentSet = sets.find(set => {
                try {
                    if (!set.start_time || !set.end_time) return false;
                    return isWithinInterval(today, {
                        start: parseISO(set.start_time),
                        end: parseISO(set.end_time)
                    });
                } catch (e) { return false; }
            });
            if (currentSet && currentSet.id !== activeSetId) {
                setActiveSetId(currentSet.id);
            }
        }
    }, [availableSets, today, activeSetId]);

    useEffect(() => {
        if (activeSetId) {
            fetchSlots();
            fetchAssignments();
            fetchJournalEntries(todayStr, todayStr);
        }
    }, [activeSetId, fetchSlots, fetchAssignments, fetchJournalEntries, todayStr]);

    const holidayInfo = getHolidayForDate(today);

    const todaySchedule = useMemo(() => {
        if (holidayInfo || !slots || Object.keys(slots).length === 0) return [];
        const dayIndex = today.getDay(); // 1=Lundi...

        return Object.values(slots)
            .filter(slot => parseInt(slot.day_of_week) === dayIndex)
            .map(slot => {
                const journalEntry = journalEntries.find(entry =>
                    String(entry.schedule_slot_id) === String(slot.id || slot.slot_id) &&
                    entry.date === todayStr
                );
                return {
                    ...slot,
                    journalEntry,
                    isCancelled: journalEntry?.actual_work === '[CANCELLED]',
                    isExam: journalEntry?.actual_work === '[EXAM]',
                    isHoliday: journalEntry?.actual_work === '[HOLIDAY]',
                    isInterro: journalEntry?.actual_work?.startsWith('[INTERRO]'),
                };
            })
            .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
    }, [slots, journalEntries, todayStr, holidayInfo, today]);

    // REDIRECTION VERS LE JOURNAL AVEC OUVERTURE MODAL
    const handleSlotClick = (course) => {
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

        // Devoirs corrigés (complétés ET !corrigés)
        const waiting = safeAssignments.filter(a => a.is_completed && !a.is_corrected);

        const totalWeeklySlots = slots ? Object.keys(slots).length : 0;
        return [
            { title: 'Total heures', value: totalWeeklySlots, icon: '🏫', color: 'primary' },
            { title: 'Cours aujourd\'hui', value: todaySchedule.length, icon: '📚', color: 'info' },
            { title: 'Evaluations prévues', value: upcoming.length, icon: '📝', color: 'warning' },
            { title: 'Corrections en attente', value: waiting.length, icon: '✅', color: 'success' }
        ];
    }, [classes, todaySchedule, assignments]);

    const isLoading = loadingClasses || loadingJournal || loadingSlots || loadingHolidays;

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
                            holidayInfo={holidayInfo}
                            getClassColor={getClassColor}
                            classes={classes}
                            loading={isLoading && !activeSetId}
                            onSlotClick={handleSlotClick}
                        />
                    </div>
                    <div className="column side-column">
                        <NoteSection />
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