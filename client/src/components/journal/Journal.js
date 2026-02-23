import React, { useState, useEffect, useMemo, useCallback } from 'react';
import './Journal.scss';
import { useJournal } from '../../hooks/useJournal';
import { useClasses } from '../../hooks/useClasses';
import { useScheduleHours } from '../../hooks/useScheduleHours';
import ScheduleService from '../../services/ScheduleService';
import { useToast } from '../../hooks/useToast';
import { useHolidays } from '../../hooks/useHolidays';
import JournalPicker from './JournalPicker';
import ConfirmModal from '../ConfirmModal';
import { format, addDays, startOfWeek, endOfWeek, parseISO, isAfter, isBefore, min, max } from 'date-fns';
import { fr } from 'date-fns/locale';

const Journal = () => {
    const { currentJournal } = useJournal();
    return currentJournal ? <JournalView /> : <JournalPicker />;
};

const JournalView = () => {
    const {
        currentJournal, upsertJournalEntry, deleteJournalEntry,
        upsertAssignment, deleteAssignment, fetchJournalEntries,
        fetchAssignments, journalEntries, assignments
    } = useJournal();

    const journalId = currentJournal?.id;
    const { hours, loading: loadingHours } = useScheduleHours();
    const { success, error: showError } = useToast();
    const { getHolidayForDate, holidays, loading: loadingHolidays } = useHolidays();

    // --- STATES ---
    const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1, locale: fr }));
    const [slots, setSlots] = useState([]);
    const [loadingSlots, setLoadingSlots] = useState(false);

    // États Modales & Formulaires
    const [showJournalModal, setShowJournalModal] = useState(false);
    const [selectedSlot, setSelectedSlot] = useState(null);
    const [selectedDay, setSelectedDay] = useState(null);
    const [journalForm, setJournalForm] = useState({ planned_work: '', actual_work: '', notes: '' });
    const [courseStatus, setCourseStatus] = useState('given');
    const [isInterro, setIsInterro] = useState(false);
    const [copyToNextSlot, setCopyToNextSlot] = useState(false);
    const [nextCourseSlot, setNextCourseSlot] = useState(null);
    const [cancelEntireDay, setCancelEntireDay] = useState(false);
    const [journalDebounce, setJournalDebounce] = useState({});

    const [showAssignmentModal, setShowAssignmentModal] = useState(false);
    const [selectedAssignment, setSelectedAssignment] = useState(null);
    const [assignmentForm, setAssignmentForm] = useState({ id: null, class_id: '', subject: '', type: 'Devoir', description: '', due_date: '', is_completed: false, is_corrected: false });
    const [confirmModal, setConfirmModal] = useState({ isOpen: false, title: '', message: '', onConfirm: null });

    const isArchived = currentJournal?.is_archived;
    const activeSetId = 1; // ID statique selon votre retour, ou à dynamiser via useScheduleModel

    // --- LOADING DATA ---
    const loadData = useCallback(async () => {
        if (!activeSetId || !journalId) return;
        setLoadingSlots(true);
        try {
            const [resSlots] = await Promise.all([
                ScheduleService.getScheduleById(activeSetId),
                fetchJournalEntries(format(currentWeekStart, 'yyyy-MM-dd'), format(addDays(currentWeekStart, 4), 'yyyy-MM-dd')),
                fetchAssignments(null, format(currentWeekStart, 'yyyy-MM-dd'), format(addDays(currentWeekStart, 4), 'yyyy-MM-dd'))
            ]);
            console.log("resSlot : ", resSlots);
            setSlots(resSlots.data || []);
        } catch (err) {
            showError('Erreur de chargement');
        } finally {
            setLoadingSlots(false);
        }
    }, [activeSetId, journalId, currentWeekStart, fetchJournalEntries, fetchAssignments, showError]);

    useEffect(() => { loadData(); }, [loadData]);

    // --- LOGIQUE D'AFFICHAGE (FILTRAGE) ---
    const visibleDays = useMemo(() => {
        const labels = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
        return labels.map((label, index) => {
            const date = addDays(currentWeekStart, index);
            const dayNum = index + 1;
            const isoKey = format(date, 'yyyy-MM-dd');
            const holiday = getHolidayForDate(date);
            const daySlots = slots
                .filter(s => s.day_of_week === dayNum)
                .sort((a, b) => a.time_slot_id - b.time_slot_id);

            return { date, label: `${label} ${format(date, 'dd/MM')}`, isoKey, dayNum, slots: daySlots, holiday };
        }).filter(d => d.slots.length > 0 || d.holiday);
    }, [currentWeekStart, slots, getHolidayForDate]);

    // --- GESTION DU JOURNAL ---
    const getEntry = (slotId, date) => journalEntries?.find(e => e.schedule_id === slotId && format(parseISO(e.date), 'yyyy-MM-dd') === date);

    const debouncedSave = (entryData) => {
        if (isArchived) return;
        const key = `${entryData.schedule_id}-${entryData.date}`;
        if (journalDebounce[key]) clearTimeout(journalDebounce[key]);
        const timeout = setTimeout(async () => {
            try {
                await upsertJournalEntry(entryData);
            } catch (err) { showError('Erreur de sauvegarde'); }
        }, 1000);
        setJournalDebounce(prev => ({ ...prev, [key]: timeout }));
    };

    const handleFormChange = (field, value) => {
        if (isArchived) return;
        const newForm = { ...journalForm, [field]: value };
        setJournalForm(newForm);

        let actualWork = (field === 'actual_work') ? value : newForm.actual_work;
        if (isInterro && !actualWork.startsWith('[INTERRO]')) actualWork = `[INTERRO] ${actualWork}`;

        const entryData = {
            ...newForm,
            schedule_id: selectedSlot.slot_id,
            date: selectedDay.isoKey,
            actual_work: actualWork
        };
        debouncedSave(entryData);

        // Propagation (Holiday/Cancelled)
        if ((courseStatus === 'holiday' || (courseStatus === 'cancelled' && cancelEntireDay)) && field === 'notes') {
            const statusTag = courseStatus === 'holiday' ? '[HOLIDAY]' : '[CANCELLED]';
            selectedDay.slots.filter(s => s.slot_id !== selectedSlot.slot_id).forEach(s => {
                debouncedSave({ schedule_id: s.slot_id, date: selectedDay.isoKey, actual_work: statusTag, notes: value });
            });
        }
    };

    const handleStatusChange = (e) => {
        const newStatus = e.target.value;
        setCourseStatus(newStatus);
        let work = '';
        let notes = journalForm.notes;

        if (newStatus === 'cancelled') work = '[CANCELLED]';
        else if (newStatus === 'exam') { work = '[EXAM]'; notes = 'Sujet : '; }
        else if (newStatus === 'holiday') { work = '[HOLIDAY]'; notes = 'Férié'; }

        const newForm = { ...journalForm, actual_work: work, notes };
        setJournalForm(newForm);
        debouncedSave({ schedule_id: selectedSlot.slot_id, date: selectedDay.isoKey, ...newForm });
    };

    const handleIsInterroChange = async (e) => {
        const checked = e.target.checked;
        setIsInterro(checked);
        const work = checked ? `[INTERRO] ${journalForm.actual_work.replace('[INTERRO]', '').trim()}` : journalForm.actual_work.replace('[INTERRO]', '').trim();
        handleFormChange('actual_work', work);

        if (checked) {
            await upsertAssignment({
                class_id: selectedSlot.class_id,
                subject: selectedSlot.subject_name,
                type: 'Interro',
                description: work.replace('[INTERRO]', '').trim(),
                due_date: selectedDay.isoKey
            });
            success('Interro créée');
        }
    };

    const handleOpenJournalModal = (slot, day) => {
        setSelectedSlot(slot);
        setSelectedDay(day);
        const entry = getEntry(slot.slot_id, day.isoKey);

        setJournalForm({
            planned_work: entry?.planned_work || '',
            actual_work: entry?.actual_work || '',
            notes: entry?.notes || ''
        });

        const status = entry?.actual_work?.includes('[CANCELLED]') ? 'cancelled' :
            entry?.actual_work?.includes('[EXAM]') ? 'exam' :
                entry?.actual_work?.includes('[HOLIDAY]') ? 'holiday' : 'given';

        setCourseStatus(status);
        setIsInterro(entry?.actual_work?.startsWith('[INTERRO]') || false);

        // Calcul du créneau suivant pour la copie
        const next = day.slots[day.slots.findIndex(s => s.slot_id === slot.slot_id) + 1];
        setNextCourseSlot(next && next.class_id === slot.class_id ? next : null);

        setShowJournalModal(true);
    };

    // --- UI HELPERS ---
    const navigateWeek = (dir) => setCurrentWeekStart(prev => addDays(prev, dir * 7));

    if (loadingHours || loadingSlots) return <div className="loading-message">Chargement du journal...</div>;

    return (
        <div className="journal-page">
            <div className="journal-header">
                <div className="journal-header-left">
                    <h1>{currentJournal?.name}</h1>
                </div>
                <div className="week-navigation">
                    <button className="btn-secondary" onClick={() => navigateWeek(-1)}>Précédent</button>
                    <button className="btn-today" onClick={() => setCurrentWeekStart(startOfWeek(new Date(), {weekStartsOn: 1}))}>Aujourd'hui</button>
                    <span>{format(currentWeekStart, 'dd/MM/yyyy')} - {format(addDays(currentWeekStart, 4), 'dd/MM/yyyy')}</span>
                    <button className="btn-secondary" onClick={() => navigateWeek(1)}>Suivant</button>
                </div>
            </div>

            <div className="journal-content">
                <div className="weekly-agenda-section">
                    <div className="journal-days-container">
                        {visibleDays.map(day => (
                            <div key={day.isoKey} className={`day-column ${day.holiday ? 'is-holiday' : ''}`}>
                                <div className="day-header-journal">{day.label}</div>
                                <div className="day-content">
                                    {day.holiday ? (
                                        <div className="holiday-card">🎉 {day.holiday.name}</div>
                                    ) : (
                                        day.slots.map(slot => {
                                            const entry = getEntry(slot.slot_id, day.isoKey);
                                            const isInterroSlot = entry?.actual_work?.startsWith('[INTERRO]');
                                            const isCancelled = entry?.actual_work === '[CANCELLED]';

                                            return (
                                                <div
                                                    key={slot.slot_id}
                                                    className={`journal-slot ${isCancelled ? 'is-cancelled' : ''} ${isInterroSlot ? 'is-interro' : ''}`}
                                                    style={{ borderLeft: `4px solid ${slot.subject_color}` }}
                                                    onClick={() => handleOpenJournalModal(slot, day)}
                                                >
                                                    <div className="course-info-header">
                                                        <span>{slot.time_label}</span>
                                                        <span>{slot.class_name}</span>
                                                    </div>
                                                    <div className="course-title-display">{slot.subject_name}</div>
                                                    {entry?.actual_work && (
                                                        <div className="journal-entry-preview">
                                                            {isInterroSlot && <span className="interro-badge">Interro</span>}
                                                            {entry.actual_work.replace('[INTERRO]', '')}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Section Assignations (simplifiée) */}
                <div className="assignments-section">
                    <h2>Assignations & Devoirs</h2>
                    <button className="btn-primary" onClick={() => setShowAssignmentModal(true)}>+ Nouveau</button>
                    {assignments.map(a => (
                        <div key={a.id} className="assignment-item">
                            <input type="checkbox" checked={a.is_completed} onChange={() => upsertAssignment({...a, is_completed: !a.is_completed})} />
                            <div>{a.subject} - {a.type}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* MODALE JOURNAL */}
            {showJournalModal && (
                <div className="modal-overlay">
                    <div className="modal">
                        <div className="modal-header">
                            <h3>{selectedSlot.subject_name} - {selectedDay.label}</h3>
                            <button onClick={() => setShowJournalModal(false)}>×</button>
                        </div>
                        <div className="modal-body-content">
                            <div className="form-group">
                                <label>Statut</label>
                                <select value={courseStatus} onChange={handleStatusChange}>
                                    <option value="given">Cours donné</option>
                                    <option value="cancelled">Annulé</option>
                                    <option value="exam">Examen</option>
                                    <option value="holiday">Vacances</option>
                                </select>
                            </div>

                            {courseStatus === 'given' && (
                                <>
                                    <div className="form-group">
                                        <label>Travail Prévu</label>
                                        <textarea value={journalForm.planned_work} onChange={(e) => handleFormChange('planned_work', e.target.value)} />
                                    </div>
                                    <div className="form-group">
                                        <label>Travail Effectué</label>
                                        <textarea value={journalForm.actual_work} onChange={(e) => handleFormChange('actual_work', e.target.value)} />
                                    </div>
                                    <div className="form-group checkbox-group">
                                        <input type="checkbox" id="int" checked={isInterro} onChange={handleIsInterroChange} />
                                        <label htmlFor="int">Interrogation</label>
                                    </div>
                                </>
                            )}

                            {(courseStatus !== 'given') && (
                                <div className="form-group">
                                    <label>Notes / Raison</label>
                                    <textarea value={journalForm.notes} onChange={(e) => handleFormChange('notes', e.target.value)} />
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Journal;