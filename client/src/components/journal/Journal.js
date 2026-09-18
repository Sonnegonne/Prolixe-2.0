import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    format,
    startOfWeek,
    addDays,
    subWeeks,
    addWeeks,
    isSameDay,
    parseISO,
    isAfter,
    isBefore,
    min,
    max,
} from 'date-fns';
import { fr } from 'date-fns/locale';
import {
    ChevronLeft,
    ChevronRight,
    Calendar as CalendarIcon,
    Clock,
    BookOpen,
    AlertCircle,
    Loader,
    Plus,
    Pencil,
    Trash2,
    X,
    CheckSquare,
    Square,
    MapPin,
    TreePalm,
    RotateCcw
} from 'lucide-react';

import { useSchedule } from '../../hooks/useSchedule';
import { useJournal } from '../../hooks/useJournal';
import { useSchools } from '../../hooks/useSchools';
import { useClasses } from '../../hooks/useClasses';
import { useHolidays } from '../../hooks/useHolidays';
import { useToast } from '../../hooks/useToast';
import { useLocation } from 'react-router-dom';
import JournalService from '../../services/JournalService';
import ScheduleService from '../../services/ScheduleService';
import ConfirmModal from '../ConfirmModal';

import './Journal.scss';

// ---------------------------------------------------------------------------
// Root component – picks the right journal or shows picker
// ---------------------------------------------------------------------------
const Journal = () => {
    const navigate = useNavigate();
    const { journals, loading: loadingJournals, currentJournal } = useJournal();
    const { hasMultipleSchools } = useSchools();
    const journalId = currentJournal?.id;

    useEffect(() => {
        if (!loadingJournals && !journalId && journals?.length > 0) {
            navigate(`/journal/${journals[0].id}`);
        }
    }, [journalId, journals, loadingJournals, navigate]);

    if (loadingJournals) {
        return (
            <div className="journal-loading">
                <Loader className="spinner" />
                <p>Chargement des journaux…</p>
            </div>
        );
    }

    return (
        <div className="journal-container">
            <header className="journal-header">
                <div className="journal-title">
                    <BookOpen size={24} />
                    <h1>{currentJournal ? currentJournal.name : 'Journal de classe'}</h1>
                    {/* Deux ecoles peuvent avoir un journal de meme intitule :
                        l'etiquette dit lequel est ouvert. */}
                    {hasMultipleSchools && currentJournal?.school_name && (
                        <span className="journal-school-tag" style={{ backgroundColor: currentJournal.school_color }}>
                            {currentJournal.school_name}
                        </span>
                    )}
                </div>
            </header>

            {journalId ? (
                <JournalView journalId={journalId} isArchived={currentJournal?.is_archived} />
            ) : (
                <div className="no-journal-selected">
                    <AlertCircle size={48} />
                    <p>Veuillez sélectionner un journal dans les paramètres.</p>
                </div>
            )}
        </div>
    );
};

// ---------------------------------------------------------------------------
// Helper – derive course status from actual_work string
// ---------------------------------------------------------------------------
const getStatusFromActualWork = (actualWork) => {
    if (!actualWork) return 'given';
    if (actualWork === '[CANCELLED]') return 'cancelled';
    if (actualWork === '[EXAM]') return 'exam';
    if (actualWork === '[HOLIDAY]') return 'holiday';
    return 'given';
};

// ---------------------------------------------------------------------------
// Helper – lien entre une assignation et le « travail prévu » du journal
// ---------------------------------------------------------------------------
// Chaque assignation reportée dans le journal y laisse une ligne préfixée par
// son propre tag ([EVAL#12]). C'est ce tag qui permet de la retrouver plus tard
// pour la mettre à jour ou la retirer sans toucher au texte saisi à la main.
const assignmentTag = (assignmentId) => `[EVAL#${assignmentId}]`;

const buildAssignmentLine = (assignment) => {
    const label = assignment.type || 'Évaluation';
    const detail = (assignment.description || '').trim();
    return `${assignmentTag(assignment.id)} ${detail ? `${label} : ${detail}` : label}`;
};

const stripAssignmentLine = (text, assignmentId) => {
    const tag = assignmentTag(assignmentId);
    return (text || '')
        .split('\n')
        .filter(line => !line.trimStart().startsWith(tag))
        .join('\n')
        .trim();
};

const withAssignmentLine = (text, assignment) => {
    const base = stripAssignmentLine(text, assignment.id);
    const line = buildAssignmentLine(assignment);
    return base ? `${base}\n${line}` : line;
};

// Affichage : les tags techniques n'ont rien à faire dans l'aperçu des cartes.
const cleanAssignmentTags = (text) => (text || '').replace(/\[EVAL#\d+\]\s*/g, '');

// JournalService passe par axios : le corps de la réponse est dans `response.data`,
// et le contrôleur y place lui-même { success, data: { id } }. L'id d'une entité
// fraîchement créée se trouve donc sous `response.data.data.id`.
const extractSavedId = (response) =>
    response?.data?.data?.id ?? response?.data?.id ?? response?.id ?? null;

// Les dates renvoyées par l'API portent parfois une heure ('2026-09-04T00:00:00.000Z') :
// on ne garde que la partie calendaire, seule clé utilisée côté journal.
const toDateKey = (value) => (value ? String(value).split('T')[0] : '');

const getClassColor = (subject, classLevel) => {
    // Deterministic colour from subject name
    const colours = [
        '#4f86c6', '#e07b39', '#5ba85b', '#b05cc7',
        '#c75c5c', '#5cbcb0', '#c7a35c', '#5c7bc7',
    ];
    let hash = 0;
    for (let i = 0; i < (subject || '').length; i++) hash += (subject || '').charCodeAt(i);
    return colours[hash % colours.length];
};

// ---------------------------------------------------------------------------
// Main weekly view
// ---------------------------------------------------------------------------
const JournalView = ({ journalId, isArchived }) => {
    const location = useLocation();
    const { success, error: showError } = useToast();
    const { classes } = useClasses(journalId);
    const { getHolidayForDate, holidays, loading: loadingHolidays } = useHolidays();

    // --- week navigation state ---
    const [currentDate, setCurrentDate] = useState(new Date());
    const currentWeekStart = useMemo(
        () => startOfWeek(currentDate, { weekStartsOn: 1 }),
        [currentDate]
    );

    // --- schedule detection ---
    const [activeSetId, setActiveSetId] = useState(null);
    const [activeSetName, setActiveSetName] = useState('');
    const { slots, loading: loadingSlots, fetchSlots } = useSchedule(activeSetId);

    // --- journal entries (sessions) ---
    const [sessions, setSessions] = useState([]);
    const [loadingSessions, setLoadingSessions] = useState(false);

    // --- assignments ---
    const [assignments, setAssignments] = useState([]);
    const [loadingAssignments, setLoadingAssignments] = useState(false);

    // --- journal entry modal ---
    const [showJournalModal, setShowJournalModal] = useState(false);
    const [selectedSlot, setSelectedSlot] = useState(null); // the schedule slot object
    const [selectedDay, setSelectedDay] = useState(null);   // { key, label }
    const [currentEntryId, setCurrentEntryId] = useState(null);
    const [courseStatus, setCourseStatus] = useState('given');
    const [journalForm, setJournalForm] = useState({ planned_work: '', actual_work: '', notes: '' });
    const [isInterro, setIsInterro] = useState(false);
    const [cancelEntireDay, setCancelEntireDay] = useState(false);
    const [copyToNextSlot, setCopyToNextSlot] = useState(false);
    const [nextSlot, setNextSlot] = useState(null);

    // --- assignment modal ---
    const [showAssignmentModal, setShowAssignmentModal] = useState(false);
    const [selectedAssignment, setSelectedAssignment] = useState(null);
    const [assignmentForm, setAssignmentForm] = useState({
        id: null, class_id: '', schedule_slot_id: '', subject: '', type: 'Devoir',
        description: '', due_date: '', is_completed: false, is_corrected: false,
    });
    const assignmentTypes = ['Interro', 'Devoir', 'Projet', 'Examen', 'Autre'];

    // --- confirm modal ---
    const [confirmModal, setConfirmModal] = useState({ isOpen: false, title: '', message: '', onConfirm: null });

    // --- debounce map ---
    const [debounceMap, setDebounceMap] = useState({});


    // -----------------------------------------------------------------------
    // Compute journal navigation bounds from holidays
    // -----------------------------------------------------------------------
    const journalBounds = useMemo(() => {
        if (!holidays || holidays.length === 0) return null;
        try {
            const validDates = holidays
                .filter(h => h.start && h.end)
                .flatMap(h => [parseISO(h.start), parseISO(h.end)]);
            if (validDates.length === 0) return null;
            return {
                start: startOfWeek(min(validDates), { weekStartsOn: 1 }),
                end: startOfWeek(max(validDates), { weekStartsOn: 1 }),
            };
        } catch { return null; }
    }, [holidays]);

    useEffect(() => {
        if (journalBounds && !loadingHolidays) {
            const today = new Date();
            // On vérifie si aujourd'hui est dans l'intervalle du journal (avec marge d'une semaine)
            const isTodayInJournal = isAfter(today, journalBounds.start) &&
                isBefore(today, addDays(journalBounds.end, 7));

            if (!isTodayInJournal) {
                // On se positionne sur le début de l'année scolaire du journal
                setCurrentDate(journalBounds.start);
            } else {
                // On reste sur aujourd'hui
                setCurrentDate(today);
            }
        }
    }, [journalId, journalBounds, loadingHolidays]);

    const isPrevDisabled = !journalBounds || !isAfter(currentWeekStart, journalBounds.start);
    const isNextDisabled = !journalBounds || !isBefore(currentWeekStart, journalBounds.end);

    // -----------------------------------------------------------------------
    // Week days (Mon–Fri) with holiday info
    // -----------------------------------------------------------------------
    const weekDays = useMemo(() =>
            Array.from({ length: 5 }).map((_, i) => {
                const date = addDays(currentWeekStart, i);
                const holidayInfo = getHolidayForDate(date);
                return {
                    date,
                    key: format(date, 'yyyy-MM-dd'),
                    label: format(date, 'EEEE dd/MM', { locale: fr }),
                    dayIndex: date.getDay(), // 1=Mon … 5=Fri
                    isHoliday: !!holidayInfo,
                    holidayName: holidayInfo?.name || null,
                };
            }),
        [currentWeekStart, getHolidayForDate]);


    const slotsByDay = useMemo(() => {
        const map = {};
        const allSlots = Object.values(slots || {});

        allSlots.forEach(slot => {
            const d = slot.day_of_week;
            if (!map[d]) map[d] = [];
            map[d].push(slot);
        });

        Object.keys(map).forEach(d => {
            map[d].sort((a, b) => (a.time_label || '').localeCompare(b.time_label || ''));
        });

        return map;
    }, [slots]);

    // Unique time rows for the grid
    const timeRows = useMemo(() =>
            [...new Map(
                Object.values(slots || {}).map(s => [s.time_slot_id, s])
            ).values()].sort((a, b) => (a.start_time || '').localeCompare(b.start_time || '')),
        [slots]);

    useEffect(() => {
        setActiveSetId(null);
        setActiveSetName('');

        let cancelled = false;
        const detect = async () => {
            try {
                const dateStr = format(currentWeekStart, 'yyyy-MM-dd');
                // journalId : sans lui, un horaire appartenant a un autre journal
                // et couvrant la meme periode peut etre retenu.
                const res = await ScheduleService.getScheduleIdByDate(dateStr, journalId);
                if (cancelled) return;
                if (res?.success && res.id) {
                    setActiveSetId(res.id);
                    setActiveSetName(res.name || `Horaire : #${res.name}`);
                }
            } catch { }
        };
        detect();
        return () => { cancelled = true; };
    }, [currentWeekStart, journalId]);

    // -----------------------------------------------------------------------
    // Step 2 – Reload slots whenever activeSetId OR the week changes.
    // Using the formatted week string as a dependency guarantees a fresh fetch
    // even when the same model ID covers multiple consecutive weeks.
    // -----------------------------------------------------------------------
    const currentWeekKey = format(currentWeekStart, 'yyyy-MM-dd');
    useEffect(() => {
        if (activeSetId) fetchSlots();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeSetId, currentWeekKey]); // fetchSlots omitted: stable ref from hook

    // -----------------------------------------------------------------------
    // Fetch journal entries (sessions)
    // -----------------------------------------------------------------------
    const loadSessions = useCallback(async () => {
        if (!journalId) return;
        setLoadingSessions(true);
        try {
            const startDate = format(currentWeekStart, 'yyyy-MM-dd');
            const endDate = format(addDays(currentWeekStart, 4), 'yyyy-MM-dd');
            const response = await JournalService.getJournalEntries(startDate, endDate, journalId);

            const rawEntries = response?.data?.data || response?.data || [];

            // --- TRANSFORMATION DES DONNÉES ---
            const mappedEntries = rawEntries.map(entry => {
                const cleanDate = entry.entry_date.split('T')[0];
                return {
                    ...entry,
                    date: cleanDate, // On crée la clé 'date' attendue par getSession
                    planned_work: entry.content_planned, // On mappe vers le nom attendu
                    actual_work: entry.content_done,
                    notes: entry.homework
                };
            });

            setSessions(mappedEntries);
        } catch (err) {
            console.error("Erreur chargement sessions:", err);
            setSessions([]);
        } finally {
            setLoadingSessions(false);
        }
    }, [journalId, currentWeekStart]);

    useEffect(() => { loadSessions(); }, [loadSessions]);

    // -----------------------------------------------------------------------
    // Fetch assignments
    // -----------------------------------------------------------------------
    const loadAssignments = useCallback(async () => {
        if (!journalId) return;
        setLoadingAssignments(true);
        try {
            const startDate = format(currentWeekStart, 'yyyy-MM-dd');
            const endDate = format(addDays(currentWeekStart, 4), 'yyyy-MM-dd');
            const response = await JournalService.getAssignments(journalId, startDate, endDate);
            const data = response?.data?.data || response?.data || [];
            setAssignments(data);
        } catch {
            setAssignments([]);
        } finally {
            setLoadingAssignments(false);
        }
    }, [journalId, currentWeekStart]);

    useEffect(() => { loadAssignments(); }, [loadAssignments]);

    // -----------------------------------------------------------------------
    // Helper – find session for a slot + date
    // -----------------------------------------------------------------------
    const getSession = useCallback((slotId, dateKey) => {
        if (!slotId || !dateKey) return null;
        return sessions.find(s => {
            const sSlotId = String(s.schedule_slot_id);
            const targetSlotId = String(slotId);

            const sessionDate = s.date || s.entry_date;
            const sDate = sessionDate ? format(new Date(sessionDate), 'yyyy-MM-dd') : null;
            return sSlotId === targetSlotId && sDate === dateKey;
        });
    }, [sessions]);

    // -----------------------------------------------------------------------
    // Helper – créneau visé par une assignation (classe + jour d'échéance)
    // -----------------------------------------------------------------------
    const findSlotForAssignment = useCallback((classId, dateKey, preferredSlotId, subject) => {
        if (!classId || !dateKey) return null;

        let dayIndex;
        try { dayIndex = parseISO(dateKey).getDay(); } catch { return null; }

        const daySlots = (slotsByDay[dayIndex] || [])
            .filter(s => String(s.class_id) === String(classId) && (s.slot_id != null || s.id != null));
        if (daySlots.length === 0) return null;

        // 1. Le créneau explicitement choisi, s'il est toujours à l'horaire ce jour-là
        if (preferredSlotId) {
            const exact = daySlots.find(s => String(s.slot_id || s.id) === String(preferredSlotId));
            if (exact) return exact;
        }
        // 2. Sinon le premier cours de la même matière
        if (subject) {
            const sameSubject = daySlots.find(s => (s.subject_name || s.subject) === subject);
            if (sameSubject) return sameSubject;
        }
        // 3. À défaut, le premier cours de la journée pour cette classe
        return daySlots[0];
    }, [slotsByDay]);

    // -----------------------------------------------------------------------
    // Report d'une assignation dans le « travail prévu » du jour concerné
    // -----------------------------------------------------------------------
    const syncAssignmentToPlannedWork = useCallback(async (assignment, { remove = false } = {}) => {
        if (!assignment?.id) return null;

        const dateKey = toDateKey(assignment.due_date);
        const slot = findSlotForAssignment(
            assignment.class_id, dateKey, assignment.schedule_slot_id, assignment.subject
        );
        if (!slot) return null;

        const slotId = slot.slot_id || slot.id;
        const entry = getSession(slotId, dateKey);
        // Rien à retirer d'une entrée qui n'existe pas encore
        if (remove && !entry) return null;

        const currentPlanned = entry?.planned_work || '';
        const nextPlanned = remove
            ? stripAssignmentLine(currentPlanned, assignment.id)
            : withAssignmentLine(currentPlanned, assignment);

        // Le tag [INTERRO] en tête du travail effectué est ce qui colore la carte
        // (classe .is-interro). On le recalcule à partir des interros réellement
        // posées sur ce créneau, pour ne pas décolorer une interro voisine.
        const currentActual = entry?.actual_work || '';
        let nextActual = currentActual;
        // [CANCELLED] / [EXAM] / [HOLIDAY] sont des statuts exclusifs : on n'y touche pas.
        if (getStatusFromActualWork(currentActual) === 'given') {
            const otherInterro = assignments.some(a =>
                String(a.id) !== String(assignment.id) &&
                String(a.schedule_slot_id) === String(slotId) &&
                toDateKey(a.due_date) === dateKey &&
                a.type === 'Interro'
            );
            const shouldTag = otherInterro || (!remove && assignment.type === 'Interro');
            const base = currentActual.replace('[INTERRO]', '').trim();
            nextActual = shouldTag ? `[INTERRO] ${base}`.trim() : base;
        }

        if (nextPlanned === currentPlanned && nextActual === currentActual) return slot;

        await JournalService.upsertJournalEntry({
            id: entry?.id || null,
            journal_id: journalId,
            schedule_slot_id: slotId,
            date: dateKey,
            planned_work: nextPlanned,
            actual_work: nextActual,
            notes: entry?.notes || '',
        });
        return slot;
    }, [findSlotForAssignment, getSession, journalId, assignments]);

    // -----------------------------------------------------------------------
    // Debounced save
    // -----------------------------------------------------------------------
    const debouncedSave = useCallback((entryData) => {
        if (isArchived || !selectedSlot) return;

        // On force l'ID du slot : soit celui passé en argument, soit celui du slot sélectionné
        const slotId = entryData.schedule_slot_id || selectedSlot.slot_id || selectedSlot.id;
        const key = `${slotId}-${entryData.date}`;

        setDebounceMap(prev => {
            if (prev[key]) clearTimeout(prev[key]);
            const id = setTimeout(async () => {
                try {
                    // IMPORTANT : On s'assure que schedule_slot_id est présent dans le payload
                    const payload = {
                        ...entryData,
                        journal_id: journalId,
                        schedule_slot_id: slotId // On l'ajoute explicitement ici
                    };

                    const response = await JournalService.upsertJournalEntry(payload);

                    // Mise à jour de l'ID de l'entrée si le backend en renvoie un nouveau
                    const newId = extractSavedId(response);
                    if (newId && String(slotId) === String(selectedSlot.slot_id || selectedSlot.id)) {
                        setCurrentEntryId(newId);
                    }

                    await loadSessions();

                } catch (err) {
                    showError('Erreur de sauvegarde : ' + err.message);
                }
                setDebounceMap(p => {
                    const n = { ...p };
                    delete n[key];
                    return n;
                });
            }, 900);
            return { ...prev, [key]: id };
        });
    }, [isArchived, journalId, selectedSlot, loadSessions, showError]);
    // -----------------------------------------------------------------------
    // Open journal modal
    // -----------------------------------------------------------------------
    const handleOpenModal = useCallback((slot, day) => {
        const slotId = slot.slot_id || slot.id; // Extraction de l'ID
        const entry = getSession(slotId, day.key);
        const aw = entry?.actual_work || '';
        const status = getStatusFromActualWork(aw);

        setCourseStatus(status);
        setIsInterro(aw.startsWith('[INTERRO]'));

        // Mise à jour du formulaire avec les données de l'entrée (ou vide par défaut)
        setJournalForm({
            planned_work: entry?.planned_work || '',
            actual_work: aw,
            notes: entry?.notes || '',
        });

        setCurrentEntryId(entry?.id || null);
        setSelectedSlot(slot);
        setSelectedDay(day);
        setCancelEntireDay(false);
        setCopyToNextSlot(false);

        // Déterminer le créneau suivant pour la fonction "Copier sur le créneau suivant"
        const daySlots = (slotsByDay[day.dayIndex] || []);
        const currentSlotId = slot.slot_id || slot.id;
        const idx = daySlots.findIndex(s => (s.slot_id || s.id) === currentSlotId);
        const next = idx > -1 && idx + 1 < daySlots.length ? daySlots[idx + 1] : null;
        setNextSlot(next && next.class_id === slot.class_id && next.subject === slot.subject ? next : null);

        setShowJournalModal(true);
    }, [getSession, slotsByDay]);

    useEffect(() => {
        const { openSlotId, weekDate } = location.state || {};

        if (openSlotId && !loadingSlots && Object.keys(slots).length > 0) {
            const slotToOpen = Object.values(slots).find(s =>
                String(s.slot_id || s.id) === String(openSlotId)
            );

            const dayToOpen = weekDays.find(d => d.key === weekDate);

            if (slotToOpen && dayToOpen) {
                handleOpenModal(slotToOpen, dayToOpen);
                // On "nettoie" l'état
                window.history.replaceState({}, document.title);
            }
        }
    }, [location.state, slots, loadingSlots, weekDays, handleOpenModal]);

    const handleCloseModal = useCallback(() => {
        setShowJournalModal(false);
        setCourseStatus('given');
    }, []);

    // -----------------------------------------------------------------------
    // Form change (auto-save debounced)
    // -----------------------------------------------------------------------
    const handleFormChange = (field, value) => {
        if (isArchived) return;
        const newForm = { ...journalForm, [field]: value };

        let actualWorkToSave = newForm.actual_work;
        if (field === 'actual_work') {
            actualWorkToSave = isInterro ? `[INTERRO] ${value}` : value;
        }

        setJournalForm(newForm);
        debouncedSave({
            id: currentEntryId,
            schedule_slot_id: selectedSlot.id,
            date: selectedDay.key,
            ...newForm,
            actual_work: actualWorkToSave,
        });

        // Propagate cancel/holiday notes
        if ((courseStatus === 'holiday' || (courseStatus === 'cancelled' && cancelEntireDay)) && field === 'notes') {
            const tag = courseStatus === 'holiday' ? '[HOLIDAY]' : '[CANCELLED]';
            (slotsByDay[selectedDay.dayIndex] || [])
                .filter(s => s.id !== selectedSlot.id)
                .forEach(s => {
                    const ex = getSession(s.id, selectedDay.key);
                    debouncedSave({ id: ex?.id || null, schedule_slot_id: s.id, date: selectedDay.key, planned_work: '', actual_work: tag, notes: value });
                });
        }

        // Copy to next slot
        if (copyToNextSlot && nextSlot) {
            const nex = getSession(nextSlot.id, selectedDay.key);
            debouncedSave({ id: nex?.id || null, schedule_slot_id: nextSlot.id, date: selectedDay.key, ...newForm, actual_work: actualWorkToSave });
        }
    };


    // -----------------------------------------------------------------------
    // Status change
    // -----------------------------------------------------------------------

    const handleResetEntireDay = async () => {
        if (isArchived || !selectedDay) return;

        const daySlots = slotsByDay[selectedDay.dayIndex] || [];

        try {
            await Promise.all(daySlots.map(s => {
                const sId = s.slot_id || s.id;
                const existing = getSession(sId, selectedDay.key);

                // On ne réinitialise que si une entrée existe
                if (existing) {
                    return JournalService.upsertJournalEntry({
                        id: existing.id,
                        journal_id: journalId,
                        schedule_slot_id: sId,
                        date: selectedDay.key,
                        planned_work: existing.planned_work || '',
                        actual_work: '', // On repasse en "Cours donné"
                        notes: ''        // On nettoie les raisons d'annulation/férié
                    });
                }
                return Promise.resolve();
            }));

            // Mettre à jour l'état local du modal actuel
            setCourseStatus('given');
            setJournalForm(prev => ({ ...prev, actual_work: '', notes: '' }));

            await loadSessions();
            success('Toute la journée a été rétablie en "Cours donnés".');
        } catch (err) {
            showError("Erreur lors du rétablissement : " + err.message);
        }
    };

    const handleStatusChange = async (e) => {
        if (isArchived) return;
        const newStatus = e.target.value;
        const oldStatus = courseStatus; // On garde en mémoire l'ancien statut
        setCourseStatus(newStatus);

        let newForm = {
            planned_work: journalForm.planned_work || '',
            actual_work: '',
            notes: journalForm.notes || ''
        };

        // Configuration du formulaire selon le nouveau statut
        if (newStatus === 'cancelled') {
            newForm.actual_work = '[CANCELLED]';
        } else if (newStatus === 'exam') {
            newForm.actual_work = '[EXAM]';
            newForm.notes = journalForm.notes || 'Sujet : ';
        } else if (newStatus === 'holiday') {
            newForm.actual_work = '[HOLIDAY]';
            newForm.notes = journalForm.notes || 'Férié';
            newForm.planned_work = ''; // On vide le prévu en cas de vacances
        } else {
            // Retour à "Cours donné"
            newForm.actual_work = '';
            // On ne vide pas notes/planned ici au cas où l'utilisateur s'est trompé
        }

        setJournalForm(newForm);

        const currentSlotId = selectedSlot.slot_id || selectedSlot.id;
        const daySlots = slotsByDay[selectedDay.dayIndex] || [];
        const otherSlots = daySlots.filter(s => String(s.slot_id || s.id) !== String(currentSlotId));

        try {
            // 1. Sauvegarder le créneau actuel immédiatement
            await JournalService.upsertJournalEntry({
                id: currentEntryId,
                journal_id: journalId,
                schedule_slot_id: currentSlotId,
                date: selectedDay.key,
                ...newForm
            });

            // 2. CAS : Passage vers VACANCES (Appliquer à tous)
            if (newStatus === 'holiday') {
                await Promise.all(otherSlots.map(s => {
                    const sId = s.slot_id || s.id;
                    const existing = getSession(sId, selectedDay.key);
                    return JournalService.upsertJournalEntry({
                        id: existing?.id || null,
                        journal_id: journalId,
                        schedule_slot_id: sId,
                        date: selectedDay.key,
                        planned_work: '',
                        actual_work: '[HOLIDAY]',
                        notes: newForm.notes
                    });
                }));
                success('Toute la journée est marquée comme "Vacances".');
            }

            // 3. CAS : Retour de VACANCES vers COURS DONNÉ (Réinitialiser tous)
            // On vérifie si on était en mode "holiday" juste avant
            if (oldStatus === 'holiday' && newStatus === 'given') {
                await Promise.all(otherSlots.map(s => {
                    const sId = s.slot_id || s.id;
                    const existing = getSession(sId, selectedDay.key);

                    // On ne réinitialise QUE si le créneau était effectivement en [HOLIDAY]
                    if (existing?.actual_work === '[HOLIDAY]') {
                        return JournalService.upsertJournalEntry({
                            id: existing.id,
                            journal_id: journalId,
                            schedule_slot_id: sId,
                            date: selectedDay.key,
                            planned_work: existing.planned_work || '',
                            actual_work: '', // On retire le tag
                            notes: ''        // On retire la note "Férié"
                        });
                    }
                    return Promise.resolve();
                }));
                success('La journée a été rétablie (vacances annulées).');
            }

            // 4. CAS : Examen (uniquement pour la même classe)
            if (newStatus === 'exam') {
                const sameClassSlots = otherSlots.filter(s => s.class_id === selectedSlot.class_id);
                await Promise.all(sameClassSlots.map(s => {
                    const sId = s.slot_id || s.id;
                    const existing = getSession(sId, selectedDay.key);
                    return JournalService.upsertJournalEntry({
                        id: existing?.id || null,
                        journal_id: journalId,
                        schedule_slot_id: sId,
                        date: selectedDay.key,
                        planned_work: '',
                        actual_work: '[EXAM]',
                        notes: newForm.notes
                    });
                }));
            }

            // Mise à jour finale des données locales
            await loadSessions();

        } catch (err) {
            showError("Erreur lors de la mise à jour : " + err.message);
        }
    };
    // -----------------------------------------------------------------------
    // Cancel entire day
    // -----------------------------------------------------------------------
    const handleCancelEntireDayChange = async (e) => {
        const checked = e.target.checked;
        setCancelEntireDay(checked);

        if (checked) {
            const daySlots = slotsByDay[selectedDay.dayIndex] || [];
            // On filtre pour ne pas traiter le slot déjà ouvert (qui sera sauvé par le formulaire)
            const otherSlots = daySlots.filter(s => String(s.slot_id || s.id) !== String(selectedSlot.slot_id || selectedSlot.id));

            try {
                // Utilisation de Promise.all pour envoyer toutes les requêtes en parallèle
                // directement via JournalService pour éviter le debounce du composant
                await Promise.all(otherSlots.map(s => {
                    const sId = s.slot_id || s.id;
                    const existing = getSession(sId, selectedDay.key);

                    return JournalService.upsertJournalEntry({
                        id: existing?.id || null,
                        journal_id: journalId,
                        schedule_slot_id: sId, // Nom attendu par le contrôleur
                        date: selectedDay.key,
                        planned_work: '',
                        actual_work: '[CANCELLED]',
                        notes: journalForm.notes
                    });
                }));

                await loadSessions();
                success('Toute la journée a été marquée comme "Annulée".');
            } catch (err) {
                showError("Erreur lors de l'annulation groupée : " + err.message);
            }
        }
    };
    // -----------------------------------------------------------------------
    // Interro toggle
    // -----------------------------------------------------------------------
// -----------------------------------------------------------------------
    // Interro toggle
    // -----------------------------------------------------------------------
    const handleIsInterroChange = async (e) => {
        const checked = e.target.checked;
        setIsInterro(checked);

        const slotId = selectedSlot.id || selectedSlot.slot_id;
        const baseWork = journalForm.actual_work.replace('[INTERRO]', '').trim();
        // Mise à jour du texte de travail effectué pour ajouter/retirer le tag [INTERRO]
        const newAw = checked ? `[INTERRO] ${baseWork}` : baseWork;

        const existing = assignments.find(a =>
            String(a.schedule_slot_id) === String(slotId) &&
            toDateKey(a.due_date) === selectedDay.key &&
            a.type === 'Interro'
        );

        // Le travail prévu et le travail effectué partent dans la même sauvegarde :
        // deux écritures concurrentes sur la même entrée s'écraseraient l'une l'autre.
        let plannedWork = journalForm.planned_work;
        let message = null;

        try {
            if (checked) {
                const newAssignment = {
                    id: existing?.id || null,
                    journal_id: journalId,
                    class_id: selectedSlot.class_id,
                    schedule_slot_id: slotId,
                    subject: selectedSlot.subject_name || selectedSlot.subject,
                    type: 'Interro',
                    description: baseWork,
                    due_date: selectedDay.key,
                    is_completed: false,
                    is_corrected: false,
                };

                const response = await JournalService.upsertAssignment(newAssignment);
                const savedId = newAssignment.id || extractSavedId(response);
                if (savedId) {
                    plannedWork = withAssignmentLine(plannedWork, { ...newAssignment, id: savedId });
                }
                message = 'Assignation "Interro" créée et reportée dans le travail prévu.';
            } else if (existing) {
                await JournalService.deleteAssignment(existing.id);
                plannedWork = stripAssignmentLine(plannedWork, existing.id);
                message = 'Assignation "Interro" retirée.';
            }
        } catch (err) {
            showError('Erreur : ' + err.message);
        }

        const updForm = { ...journalForm, actual_work: newAw, planned_work: plannedWork };
        setJournalForm(updForm);

        // Sauvegarde de la note de cours (travail prévu + effectué en une seule requête)
        debouncedSave({
            id: currentEntryId,
            schedule_slot_id: slotId,
            date: selectedDay.key,
            ...updForm
        });

        await loadAssignments();
        if (message) success(message);
    };

    // -----------------------------------------------------------------------
    // Validate planned work
    // -----------------------------------------------------------------------

    const handleValidatePlannedWork = () => {
        if (isArchived || !journalForm.planned_work) return;

        // On copie le texte, sans les tags [EVAL#…] et en conservant le tag [INTERRO]
        const done = cleanAssignmentTags(journalForm.planned_work).trim();
        const updatedForm = {
            ...journalForm,
            actual_work: isInterro ? `[INTERRO] ${done}`.trim() : done
        };

        setJournalForm(updatedForm);

        // Sauvegarde immédiate
        debouncedSave({
            id: currentEntryId,
            schedule_slot_id: selectedSlot.id || selectedSlot.slot_id,
            date: selectedDay.key,
            ...updatedForm
        });

        success('Travail prévu validé et copié dans le travail effectué.');
    };

    // -----------------------------------------------------------------------
    // Copy to next slot
    // -----------------------------------------------------------------------
    const handleCopyToNextSlotChange = async (e) => {
        if (isArchived) return;
        const checked = e.target.checked;
        setCopyToNextSlot(checked);
        if (checked && nextSlot) {
            try {
                const nextId = nextSlot.slot_id || nextSlot.id;

                if (!nextId) {
                    throw new Error("L'identifiant du créneau suivant est introuvable.");
                }
                const payload = {
                    ...journalForm,               // Données textuelles (planned, actual, notes)
                    journal_id: journalId,        // ID du carnet
                    date: selectedDay.key,        // Date du jour
                    schedule_slot_id: nextId      // L'ID du créneau cible (forcé à la fin)
                };

                await JournalService.upsertJournalEntry(payload);
                await loadSessions();
                success('Notes copiées sur le créneau suivant.');
            } catch (err) { showError('Erreur : ' + err.message); setCopyToNextSlot(false); }
        }
    };

    // -----------------------------------------------------------------------
    // Delete journal entry
    // -----------------------------------------------------------------------
    const handleDeleteJournalEntry = async () => {
        if (!currentEntryId || isArchived) return;
        try {
            await JournalService.deleteJournalEntry(currentEntryId);
            await loadSessions();
            success('Entrée supprimée.');
            handleCloseModal();
        } catch (err) { showError(err.message); }
    };

    // -----------------------------------------------------------------------
    // Assignments CRUD
    // -----------------------------------------------------------------------
    const handleSaveAssignment = async (e) => {
        e.preventDefault();
        if (isArchived) return;
        if (!assignmentForm.class_id || !assignmentForm.subject || !assignmentForm.type || !assignmentForm.due_date) {
            return showError('Veuillez remplir tous les champs obligatoires.');
        }
        try {
            // Le créneau visé est figé à la sauvegarde : c'est lui qui reçoit le
            // report dans le travail prévu, et il reste modifiable dans le formulaire.
            const targetSlot = findSlotForAssignment(
                assignmentForm.class_id,
                assignmentForm.due_date,
                assignmentForm.schedule_slot_id,
                assignmentForm.subject
            );
            const payload = {
                ...assignmentForm,
                journal_id: journalId,
                schedule_slot_id: targetSlot ? (targetSlot.slot_id || targetSlot.id) : null,
            };

            const response = await JournalService.upsertAssignment(payload);
            const savedId = payload.id || extractSavedId(response);

            // L'assignation a pu changer de jour ou de créneau : on nettoie l'ancien.
            if (selectedAssignment?.id) {
                const oldKey = `${selectedAssignment.schedule_slot_id ?? ''}|${toDateKey(selectedAssignment.due_date)}`;
                const newKey = `${payload.schedule_slot_id ?? ''}|${payload.due_date}`;
                if (oldKey !== newKey) {
                    await syncAssignmentToPlannedWork(selectedAssignment, { remove: true });
                }
            }

            const reported = savedId
                ? await syncAssignmentToPlannedWork({ ...payload, id: savedId })
                : null;

            await Promise.all([loadAssignments(), loadSessions()]);
            success(reported
                ? 'Assignation sauvegardée et reportée dans le travail prévu.'
                : 'Assignation sauvegardée (aucun cours de cette classe ce jour-là : pas de report).');
            setShowAssignmentModal(false);
        } catch (err) { showError(err.message); }
    };

    const handleDeleteAssignment = async () => {
        if (!selectedAssignment?.id || isArchived) return;
        try {
            await JournalService.deleteAssignment(selectedAssignment.id);
            await syncAssignmentToPlannedWork(selectedAssignment, { remove: true });
            await Promise.all([loadAssignments(), loadSessions()]);
            success('Assignation supprimée (et retirée du travail prévu).');
            setShowAssignmentModal(false);
            setConfirmModal({ isOpen: false });
        } catch (err) { showError(err.message); }
    };

    const availableDueDates = useMemo(() => {
        if (!assignmentForm.class_id) return [];
        const dates = [];
        for (let i = 0; i < 5; i++) {
            const date = addDays(currentWeekStart, i);
            const dayIdx = date.getDay();
            const hasClass = (slotsByDay[dayIdx] || []).some(s => String(s.class_id) === String(assignmentForm.class_id));
            if (hasClass && !getHolidayForDate(date)) {
                dates.push({ value: format(date, 'yyyy-MM-dd'), label: format(date, 'EEEE dd MMMM', { locale: fr }) });
            }
        }
        return dates;
    }, [assignmentForm.class_id, currentWeekStart, slotsByDay, getHolidayForDate]);

    // Créneaux de la classe le jour de l'échéance : c'est l'un d'eux qui portera
    // le report dans le travail prévu.
    const availableSlotsForDueDate = useMemo(() => {
        if (!assignmentForm.class_id || !assignmentForm.due_date) return [];
        let dayIndex;
        try { dayIndex = parseISO(assignmentForm.due_date).getDay(); } catch { return []; }
        return (slotsByDay[dayIndex] || [])
            .filter(s => String(s.class_id) === String(assignmentForm.class_id) && (s.slot_id != null || s.id != null));
    }, [assignmentForm.class_id, assignmentForm.due_date, slotsByDay]);

    // -----------------------------------------------------------------------
    // Navigation helpers
    // -----------------------------------------------------------------------
    const prevWeek = () => setCurrentDate(subWeeks(currentDate, 1));
    const nextWeek = () => setCurrentDate(addWeeks(currentDate, 1));
    const goToToday = () => setCurrentDate(new Date());
    const goToStart = () => { if (journalBounds) setCurrentDate(journalBounds.start); };
    const goToEnd = () => { if (journalBounds) setCurrentDate(journalBounds.end); };

    // -----------------------------------------------------------------------
    // Render helpers
    // -----------------------------------------------------------------------
    const renderSlotCard = (slot, day) => {
        const entry = getSession(slot.slot_id || slot.id, day.key);
        const aw = entry?.actual_work || '';
        const isCancelled = aw === '[CANCELLED]';
        const isExam = aw === '[EXAM]';
        const isManualHoliday = aw === '[HOLIDAY]';
        const isInterroSlot = aw.startsWith('[INTERRO]');

        const cancelReason = entry?.notes;

        const subjectColor = slot.subject_color || '#0d9488';
        const cardStatusClass = isCancelled ? 'is-cancelled' : isExam ? 'is-exam' : isManualHoliday ? 'is-holiday-slot' : isInterroSlot ? 'is-interro' : '';

        // Détermination du texte à afficher et de sa nature
        let previewText = null;
        let contentType = ''; // 'actual' ou 'planned'

        if (entry && !isCancelled && !isExam && !isManualHoliday) {
            const done = isInterroSlot
                ? entry.actual_work.replace('[INTERRO]', '').trim()
                : (entry.actual_work || '');
            const planned = cleanAssignmentTags(entry.planned_work).trim();

            if (done) {
                previewText = done;
                contentType = 'actual';
            } else if (planned) {
                // Cas d'une interro annoncée : le tag colore déjà la carte, mais
                // seul le travail prévu a du texte à montrer.
                previewText = planned;
                contentType = 'planned';
            }
        }

        return (
            <div
                key={slot.slot_id || slot.id}
                className={`journal-slot ${cardStatusClass}`}
                style={{ '--subject-color': subjectColor }}
                onClick={() => handleOpenModal(slot, day)}
            >
                <div className="slot-meta">
                <span className="slot-time">
                    {slot.time_label}
                </span>
                    <span className="slot-badge" style={{ backgroundColor: `${subjectColor}15`, color: subjectColor }}>
                    {slot.class_name || '—'}
                </span>
                </div>

                <div className="slot-content">
                    <div className="slot-subject">{slot.subject_name || slot.subject}</div>
                    {slot.room && (
                        <div className="slot-room">
                            <MapPin size={12} strokeWidth={2.5} />
                            <span>Salle {slot.room}</span>
                        </div>
                    )}
                </div>

                <div className="slot-footer">
                    {isCancelled ? (
                        <div className="status-tag-container">
                            <span className="status-tag tag-red">Annulé</span>
                            {cancelReason && (
                                <span className="cancel-reason-text"> : {cancelReason}</span>
                            )}
                        </div>
                    ) : isExam ? (
                        <span className="status-tag tag-amber">Examen</span>
                    ) : isManualHoliday ? (
                        <span className="status-tag tag-amber">Férié</span>
                    ) : previewText ? (
                        <div className={`slot-preview ${contentType === 'actual' ? 'is-actual' : 'is-planned'}`}>
                            {contentType === 'actual' ? (
                                <CheckSquare size={12} className="status-icon" />
                            ) : (
                                <Clock size={12} className="status-icon" />
                            )}
                            <span className="preview-text">
                            {isInterroSlot && <span className="interro-label">Interro: </span>}
                                {previewText}
                        </span>
                        </div>
                    ) : (
                        <span className="add-hint">+ Notes</span>
                    )}
                </div>
            </div>
        );
    };
    const isLoading = loadingSlots || loadingHolidays;

    if (isLoading) {
        return <div className="loading-state"><Loader className="spinner" /> Chargement…</div>;
    }

    return (
        <div className="journal-view">
            {/* ---- Controls ---- */}
            <div className="journal-controls">
                <div className="week-navigation">
                    <button className="nav-btn" onClick={goToStart} disabled={isPrevDisabled} title="Début" aria-label="Début"><ChevronLeft size={16} /><ChevronLeft size={16} /></button>
                    <button className="nav-btn" onClick={prevWeek} disabled={isPrevDisabled} title="Semaine précédente" aria-label="Semaine précédente"><ChevronLeft size={20} /></button>
                    <button className="today-btn" onClick={goToToday}>Aujourd'hui</button>
                    <button className="nav-btn" onClick={nextWeek} disabled={isNextDisabled} title="Semaine suivante" aria-label="Semaine suivante"><ChevronRight size={20} /></button>
                    <button className="nav-btn" onClick={goToEnd} disabled={isNextDisabled} title="Fin" aria-label="Fin"><ChevronRight size={16} /><ChevronRight size={16} /></button>
                </div>

                <div className="current-range">
                    <CalendarIcon size={16} />
                    <span>
                        Semaine du {format(currentWeekStart, 'd MMM', { locale: fr })} au{' '}
                        {format(addDays(currentWeekStart, 4), 'd MMM yyyy', { locale: fr })}
                    </span>
                </div>

                <div className="schedule-indicator">
                    <Clock size={14} />
                    <span>Horaire : <strong>{activeSetId ? activeSetName : 'Aucun modèle actif'}</strong></span>
                </div>
            </div>

            {/* ---- Main content ---- */}
            <div className="journal-content">
                <div className="weekly-section">
                    <h2>Journal des cours</h2>

                    {!activeSetId ? (
                        <div className="error-box">
                            <AlertCircle size={20} />
                            <p>Aucun emploi du temps n'est défini pour cette période ({format(currentWeekStart, 'dd/MM/yyyy', { locale: fr })} – {format(addDays(currentWeekStart, 4), 'dd/MM/yyyy', { locale: fr })}).</p>
                        </div>
                    ) : (
                        <div className="days-grid">
                            {weekDays
                                .filter(day => {
                                    const daySlots = (slotsByDay[day.dayIndex] || []).filter(s => s.slot_id != null || s.id != null);
                                    return daySlots.length > 0 || day.isHoliday;
                                })
                                .map(day => {
                                    const daySlots = (slotsByDay[day.dayIndex] || []).filter(s => s.slot_id != null || s.id != null);
                                    return (
                                        <div key={day.key} className={`day-column${day.isHoliday ? ' is-holiday-day' : ''}`}>
                                            <div className="day-header">
                                                <span className="day-name">{format(day.date, 'EEEE', { locale: fr })}</span>
                                                <span className="day-date">{format(day.date, 'dd/MM', { locale: fr })}</span>
                                            </div>
                                            <div className="day-body">
                                                {day.isHoliday ? (
                                                    <div className="holiday-card">
                                                        <span className="holiday-icon"><TreePalm color={'white'} /></span>
                                                        <span className="holiday-name">{day.holidayName}</span>
                                                    </div>
                                                ) : (
                                                    daySlots.map(slot => renderSlotCard(slot, day))
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                        </div>
                    )}
                </div>

                {/* Assignments section */}
                <div className="assignments-section">
                    <div className="assignments-header">
                        <h2>Assignations &amp; Évaluations</h2>
                        {!isArchived && (
                            <button className="btn-primary" onClick={() => {
                                setSelectedAssignment(null);
                                setAssignmentForm({ id: null, class_id: '', schedule_slot_id: '', subject: '', type: 'Devoir', description: '', due_date: '', is_completed: false, is_corrected: false });
                                setShowAssignmentModal(true);
                            }}>
                                <Plus size={14} /> Nouvelle
                            </button>
                        )}
                    </div>
                    {loadingAssignments ? (
                        <p className="loading-small">Chargement…</p>
                    ) : assignments.length === 0 ? (
                        <p className="empty-note">Aucune assignation prévue cette semaine.</p>
                    ) : (
                        <div className="assignment-list">
                            {assignments.filter(a => a.id != null).map(assign => {
                                const cls = classes.find(c => c.id === assign.class_id);
                                return (
                                    <div key={assign.id} className={`assignment-item${assign.is_completed && assign.is_corrected ? ' fully-done' : ''}`}>
                                        <button className="check-btn" disabled={isArchived} onClick={() => {
                                            if (isArchived) return;
                                            const payload = { ...assign, is_completed: !assign.is_completed };
                                            if (!payload.is_completed) payload.is_corrected = false;
                                            JournalService.upsertAssignment(payload).then(loadAssignments);
                                        }}>
                                            {assign.is_completed ? <CheckSquare size={18} /> : <Square size={18} />}
                                        </button>
                                        <div className="assignment-details">
                                            <strong>{assign.subject} <span className="type-badge">{assign.type}</span></strong>
                                            {assign.due_date && (
                                                <small>Pour le {format(parseISO(assign.due_date), 'dd/MM/yy', { locale: fr })} · {cls?.name || '—'}</small>
                                            )}
                                            {assign.description && <p className="assign-desc">{assign.description}</p>}
                                        </div>
                                        {assign.is_completed && (
                                            <label className="corrected-label">
                                                <input
                                                    type="checkbox"
                                                    checked={!!assign.is_corrected}
                                                    disabled={isArchived}
                                                    onChange={() => {
                                                        const payload = { ...assign, is_corrected: !assign.is_corrected  };
                                                        JournalService.upsertAssignment(payload).then(loadAssignments);
                                                    }}
                                                />
                                                Corrigé
                                            </label>
                                        )}
                                        {!isArchived && (
                                            <button className="btn-icon" onClick={() => {
                                                setSelectedAssignment(assign);
                                                setAssignmentForm({
                                                    ...assign,
                                                    schedule_slot_id: assign.schedule_slot_id ?? '',
                                                    due_date: toDateKey(assign.due_date),
                                                });
                                                setShowAssignmentModal(true);
                                            }}><Pencil size={14} /></button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* ================================================================
                JOURNAL ENTRY MODAL
            ================================================================ */}
            {showJournalModal && selectedSlot && selectedDay && (
                <div className="modal-overlay" onClick={handleCloseModal}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>
                                {selectedSlot.subject} &middot; {format(parseISO(selectedDay.key), 'EEEE dd/MM', { locale: fr })}
                            </h3>
                            <button className="modal-close" onClick={handleCloseModal}><X size={18} /></button>
                        </div>
                        <div className="modal-body">
                            {/* Status with Reset Button */}
                            <div className="form-group">
                                <label>Statut du cours</label>
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                    <select
                                        value={courseStatus}
                                        onChange={handleStatusChange}
                                        disabled={isArchived}
                                        style={{ flex: 1 }}
                                    >
                                        <option value="given">Cours donné</option>
                                        <option value="cancelled">Cours annulé</option>
                                        <option value="exam">Période d'examen</option>
                                        <option value="holiday">Vacances / Férié</option>
                                    </select>

                                    {!isArchived && (
                                        <button
                                            type="button"
                                            className="btn-reset-day"
                                            onClick={() => setConfirmModal({
                                                isOpen: true,
                                                title: 'Rétablir la journée',
                                                message: 'Voulez-vous repasser TOUS les créneaux de cette journée en "Cours donné" et effacer les notes d\'annulation ou de vacances ?',
                                                onConfirm: handleResetEntireDay
                                            })}
                                            title="Rétablir toute la journée (F5)" aria-label="Rétablir toute la journée (F5)"
                                        >
                                            <RotateCcw size={14} />
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Planned work (given or cancelled) */}
                            {(courseStatus === 'given' || courseStatus === 'cancelled') && (
                                <div className="form-group">
                                    <label>Travail prévu</label>
                                    <textarea
                                        value={journalForm.planned_work}
                                        onChange={e => handleFormChange('planned_work', e.target.value)}
                                        placeholder="Décrivez le travail prévu…"
                                        rows={3}
                                        disabled={isArchived}
                                    />
                                </div>
                            )}

                            {/* Status-specific fields */}
                            {courseStatus === 'given' && (
                                <>
                                    <div className="form-group">
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.45rem' }}>
                                            <label style={{ margin: 0 }}>Travail effectué</label>

                                            {/* BOUTON VALIDER LE PRÉVU */}
                                            {journalForm.planned_work && !journalForm.actual_work.replace('[INTERRO]', '').trim() && (
                                                <button
                                                    type="button"
                                                    className="btn-validate-planned"
                                                    onClick={handleValidatePlannedWork}
                                                    title="Copier le travail prévu ici" aria-label="Copier le travail prévu ici"
                                                >
                                                    <CheckSquare size={14} /> Effectué
                                                </button>
                                            )}
                                        </div>
                                        <textarea
                                            value={journalForm.actual_work}
                                            onChange={e => handleFormChange('actual_work', e.target.value)}
                                            placeholder="Décrivez le travail réellement effectué…"
                                            rows={3}
                                            disabled={isArchived}
                                        />
                                    </div>
                                    <div className="form-group checkbox-group">
                                        <input type="checkbox" id="isInterro" checked={isInterro} onChange={handleIsInterroChange} disabled={isArchived} />
                                        <label htmlFor="isInterro">Cette heure est une interrogation</label>
                                    </div>
                                    <div className="form-group">
                                        <label>Notes supplémentaires</label>
                                        <textarea
                                            value={journalForm.notes}
                                            onChange={e => handleFormChange('notes', e.target.value)}
                                            placeholder="Notes libres…"
                                            rows={2}
                                            disabled={isArchived}
                                        />
                                    </div>
                                    {nextSlot && !isArchived && (
                                        <div className="form-group checkbox-group">
                                            <input
                                                type="checkbox"
                                                id="copyNext"
                                                checked={copyToNextSlot}
                                                onChange={handleCopyToNextSlotChange}
                                            />
                                            <label htmlFor="copyNext">
                                                Étendre aux deux heures {nextSlot.start_time?.substring(0, 5)}
                                            </label>
                                        </div>
                                    )}
                                </>
                            )}

                            {courseStatus === 'cancelled' && (
                                <>
                                    <div className="form-group">
                                        <label>Raison de l'annulation</label>
                                        <textarea
                                            value={journalForm.notes}
                                            onChange={e => handleFormChange('notes', e.target.value)}
                                            placeholder="Ex : Grève, Maladie…"
                                            rows={3}
                                            disabled={isArchived}
                                        />
                                    </div>
                                    <div className="form-group checkbox-group">
                                        <input type="checkbox" id="cancelDay" checked={cancelEntireDay} onChange={handleCancelEntireDayChange} disabled={isArchived} />
                                        <label htmlFor="cancelDay">Annuler toute la journée</label>
                                    </div>
                                </>
                            )}

                            {courseStatus === 'exam' && (
                                <div className="form-group">
                                    <label>Sujet / informations</label>
                                    <textarea
                                        value={journalForm.notes}
                                        onChange={e => handleFormChange('notes', e.target.value)}
                                        placeholder="Ex : Sujet, matériel autorisé…"
                                        rows={3}
                                        disabled={isArchived}
                                    />
                                </div>
                            )}

                            {courseStatus === 'holiday' && (
                                <div className="form-group">
                                    <label>Motif (appliqué à la journée)</label>
                                    <textarea
                                        value={journalForm.notes}
                                        onChange={e => handleFormChange('notes', e.target.value)}
                                        placeholder="Ex : Jour blanc, Fête de l'école…"
                                        rows={3}
                                        disabled={isArchived}
                                    />
                                </div>
                            )}
                        </div>
                        <div className="modal-footer">
                            {currentEntryId && !isArchived && (
                                <button className="btn-danger" onClick={handleDeleteJournalEntry}><Trash2 size={14} /> Supprimer</button>
                            )}
                            <button className="btn-secondary" onClick={handleCloseModal}>Fermer</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ================================================================
                ASSIGNMENT MODAL
            ================================================================ */}
            {showAssignmentModal && (
                <div className="modal-overlay" onClick={() => setShowAssignmentModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>{selectedAssignment ? 'Modifier l\'assignation' : 'Nouvelle assignation'}</h3>
                            <button className="modal-close" onClick={() => setShowAssignmentModal(false)}><X size={18} /></button>
                        </div>
                        <div className="modal-body">
                            <form id="assignment-form" onSubmit={handleSaveAssignment}>
                                <div className="form-group">
                                    <label>Classe</label>
                                    <select value={assignmentForm.class_id} onChange={e => setAssignmentForm({ ...assignmentForm, class_id: e.target.value, schedule_slot_id: '' })} required disabled={isArchived}>
                                        <option value="">Sélectionnez une classe</option>
                                        {classes.map(cls => <option key={cls.id} value={cls.id}>{cls.name}</option>)}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>Matière</label>
                                    <input type="text" value={assignmentForm.subject} onChange={e => setAssignmentForm({ ...assignmentForm, subject: e.target.value })} required disabled={isArchived} />
                                </div>
                                <div className="form-group">
                                    <label>Type</label>
                                    <select value={assignmentForm.type} onChange={e => setAssignmentForm({ ...assignmentForm, type: e.target.value })} required disabled={isArchived}>
                                        {assignmentTypes.map(t => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>Description</label>
                                    <textarea value={assignmentForm.description} onChange={e => setAssignmentForm({ ...assignmentForm, description: e.target.value })} rows={3} disabled={isArchived} />
                                </div>
                                <div className="form-group">
                                    <label>Date d'échéance</label>
                                    <select value={assignmentForm.due_date} onChange={e => setAssignmentForm({ ...assignmentForm, due_date: e.target.value, schedule_slot_id: '' })} required disabled={isArchived}>
                                        <option value="">Sélectionnez une date</option>
                                        {availableDueDates.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                                    </select>
                                </div>
                                {availableSlotsForDueDate.length > 1 && (
                                    <div className="form-group">
                                        <label>Heure de cours concernée</label>
                                        <select
                                            value={assignmentForm.schedule_slot_id || ''}
                                            onChange={e => setAssignmentForm({ ...assignmentForm, schedule_slot_id: e.target.value })}
                                            disabled={isArchived}
                                        >
                                            <option value="">Premier cours de la journée</option>
                                            {availableSlotsForDueDate.map(s => (
                                                <option key={s.slot_id || s.id} value={s.slot_id || s.id}>
                                                    {s.time_label} · {s.subject_name || s.subject}
                                                </option>
                                            ))}
                                        </select>
                                        <small className="field-hint">L'assignation est reportée dans le travail prévu de ce créneau.</small>
                                    </div>
                                )}
                            </form>
                        </div>
                        <div className="modal-footer">
                            {selectedAssignment && !isArchived && (
                                <button type="button" className="btn-danger" onClick={() => setConfirmModal({
                                    isOpen: true,
                                    title: 'Supprimer l\'assignation',
                                    message: 'Êtes-vous sûr de vouloir supprimer cette assignation ?',
                                    onConfirm: handleDeleteAssignment,
                                })}>
                                    <Trash2 size={14} /> Supprimer
                                </button>
                            )}
                            <button type="submit" form="assignment-form" className="btn-primary" disabled={isArchived}>Sauvegarder</button>
                        </div>
                    </div>
                </div>
            )}

            <ConfirmModal
                isOpen={confirmModal.isOpen}
                title={confirmModal.title}
                message={confirmModal.message}
                onClose={() => setConfirmModal({ isOpen: false })}
                onConfirm={confirmModal.onConfirm}
                confirmText="Confirmer"
                cancelText="Annuler"
                type="danger"
            />
        </div>
    );
};

export default Journal;