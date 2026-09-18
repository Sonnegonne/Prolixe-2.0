// frontend/src/components/Horaire.js
import React, { useEffect, useMemo, useState } from 'react';
import { useScheduleHours } from '../../hooks/useScheduleHours';
import { useSchedule } from '../../hooks/useSchedule';
import { useScheduleOverview, startMinutes } from '../../hooks/useScheduleOverview';
import { useJournal } from "../../hooks/useJournal";
import { useSchools } from "../../hooks/useSchools";
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { MEDIA } from '../../utils/breakpoints';
import { format } from 'date-fns';
import './Horaire.scss';
import {
    Calendar,
    Clock,
    MapPin,
    User,
    Loader2,
    ChevronDown
} from "lucide-react";

const ALL_DAYS = [
    { id: 1, name: 'Lundi', short: 'Lun' },
    { id: 2, name: 'Mardi', short: 'Mar' },
    { id: 3, name: 'Mercredi', short: 'Mer' },
    { id: 4, name: 'Jeudi', short: 'Jeu' },
    { id: 5, name: 'Vendredi', short: 'Ven' },
    { id: 6, name: 'Samedi', short: 'Sam' }
];

// Couleurs dérivées de la matière, partagées par les deux vues.
const courseVars = (assignment) => {
    const c = assignment?.color || assignment?.subject_color || '#0d9488';
    return {
        '--course-color': c,
        '--course-bg': `${c}15`,
        '--course-bg-hover': `${c}25`,
        '--course-glow': `${c}40`,
    };
};

// Carte d'un cours, commune aux deux modes. La pastille d'école n'apparaît
// que dans la vue combinée : ailleurs, le contexte suffit à savoir où l'on est.
const CourseCard = ({ course, school, compact = false }) => (
    <div className="assignment-card" style={courseVars(course)}>
        {school && (
            <span className="course-school" style={{ '--school-color': school.color }}>
                {school.short_name || school.name}
            </span>
        )}
        <div className="subject-name">{course.subject_name}</div>
        <div className="assignment-meta">
            <span className="meta-item"><MapPin size={compact ? 10 : 12} aria-hidden="true" /> {course.room || '-'}</span>
            <span className="meta-item"><User size={compact ? 10 : 12} aria-hidden="true" /> {course.class_name || 'N/A'}</span>
        </div>
    </div>
);

const Horaire = () => {
    const { currentJournal, journals } = useJournal();
    const { schools, currentSchoolId, hasMultipleSchools } = useSchools();

    // Portée affichée : 'all' (toutes les écoles) ou l'id d'une école.
    // Avec un seul établissement, la question ne se pose pas.
    const [scope, setScope] = useState(() => (hasMultipleSchools ? 'all' : 'single'));
    useEffect(() => {
        if (!hasMultipleSchools) setScope('single');
    }, [hasMultipleSchools]);

    const isCombined = scope === 'all' && hasMultipleSchools;

    // Le mode combiné raisonne en date (quel horaire fait foi ce jour-là),
    // le mode école en modèle d'horaire choisi à la main.
    const [overviewDate, setOverviewDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
    const [selectedSetId, setSelectedSetId] = useState("");

    const isMobile = useMediaQuery(MEDIA.mobile);

    // École affichée en mode « une école » : celle demandée, sinon la courante.
    const scopedSchoolId = useMemo(() => {
        if (scope === 'all' || scope === 'single') return currentSchoolId;
        return parseInt(scope, 10);
    }, [scope, currentSchoolId]);

    // Journal de cette école : celui marqué courant, à défaut le premier actif.
    const scopedJournalId = useMemo(() => {
        if (!scopedSchoolId || scopedSchoolId === currentSchoolId) return currentJournal?.id;
        const inSchool = (journals || []).filter(j => j.school_id === scopedSchoolId && !j.is_archived);
        return (inSchool.find(j => j.is_current) || inSchool[0])?.id;
    }, [scopedSchoolId, currentSchoolId, currentJournal, journals]);

    const {
        slots,
        availableSets,
        loading: scheduleLoading,
        fetchSlots,
        fetchAllSets
    } = useSchedule(selectedSetId);

    const { hours, loading: hoursLoading } = useScheduleHours(scopedSchoolId);

    const overview = useScheduleOverview(isCombined ? overviewDate : null);

    useEffect(() => {
        if (isCombined || !scopedJournalId) return;
        let cancelled = false;
        const init = async () => {
            const result = await fetchAllSets(scopedJournalId);
            if (cancelled) return;
            const setsArray = result?.data || result;
            // Le dernier horaire créé est celui qu'on veut voir par défaut.
            setSelectedSetId(Array.isArray(setsArray) && setsArray.length > 0
                ? setsArray[setsArray.length - 1].id
                : "");
        };
        init();
        return () => { cancelled = true; };
    }, [fetchAllSets, scopedJournalId, isCombined]);

    useEffect(() => {
        if (!isCombined && selectedSetId) fetchSlots();
    }, [selectedSetId, fetchSlots, isCombined]);

    const activeDays = useMemo(() => {
        if (isCombined) {
            const used = new Set(overview.courses.map(c => parseInt(c.day_of_week, 10)));
            const days = ALL_DAYS.filter(day => used.has(day.id));
            return days.length > 0 ? days : ALL_DAYS.slice(0, 5);
        }
        if (!slots || Object.keys(slots).length === 0) return ALL_DAYS;
        return ALL_DAYS.filter(day => Object.keys(slots).some(key => key.startsWith(`${day.id}-`)));
    }, [slots, isCombined, overview.courses]);

    // Les libellés sont au format HH:MM-HH:MM, mais la validation côté serveur
    // accepte aussi « 8:30 ». Un tri texte placerait alors 10:00 avant 8:30 :
    // on compare donc les minutes du début de créneau.
    const sortedHours = useMemo(
        () => [...hours].sort((a, b) => startMinutes(a.libelle) - startMinutes(b.libelle)),
        [hours]
    );

    // Une ligne de grille : un libellé horaire, quel que soit le mode.
    const gridRows = useMemo(() => (
        isCombined
            ? overview.rows.map(row => ({ key: row.libelle, libelle: row.libelle }))
            : sortedHours.map(hour => ({ key: hour.id, libelle: hour.libelle, hourId: hour.id }))
    ), [isCombined, overview.rows, sortedHours]);

    const setsList = useMemo(() => {
        return Array.isArray(availableSets?.data) ? availableSets.data : (Array.isArray(availableSets) ? availableSets : []);
    }, [availableSets]);

    // Vue mobile : un jour à la fois, celui du jour par défaut.
    const [selectedDayId, setSelectedDayId] = useState(() => {
        const today = new Date().getDay();
        return today >= 1 && today <= 6 ? today : 1;
    });

    useEffect(() => {
        if (activeDays.length === 0) return;
        if (!activeDays.some(day => day.id === selectedDayId)) {
            setSelectedDayId(activeDays[0].id);
        }
    }, [activeDays, selectedDayId]);

    const gridStyle = {
        gridTemplateColumns: `60px repeat(${activeDays.length}, minmax(140px, 1fr))`
    };

    // Cours d'une case (jour × créneau) : 0, 1, ou plusieurs si deux écoles
    // se chevauchent.
    const cellCourses = (dayId, row) => {
        if (isCombined) return overview.getCell(dayId, row.libelle);
        const assignment = slots[`${dayId}-${row.hourId}`];
        return assignment ? [assignment] : [];
    };

    const isLoading = isCombined
        ? overview.loading
        : (hoursLoading || (!selectedSetId && scheduleLoading));

    if (isLoading) {
        return (
            <div className="horaire-loader-container">
                <Loader2 className="spinner" size={32} />
                <span>Chargement de l'emploi du temps...</span>
            </div>
        );
    }

    const selectedDay = activeDays.find(day => day.id === selectedDayId) || activeDays[0];
    const daySlots = selectedDay
        ? gridRows.map(row => ({ row, courses: cellCourses(selectedDay.id, row) }))
        : [];
    const dayHasCourse = daySlots.some(entry => entry.courses.length > 0);

    return (
        <div className="horaire-container">
            <header className="horaire-header">
                <div className="title-wrapper">
                    <Calendar className="header-icon" />
                    <h1>Emploi du Temps</h1>
                </div>

                <div className="select-container">
                    {isCombined ? (
                        <div className="custom-select-wrapper">
                            <label className="sr-only" htmlFor="horaire-date">Semaine du</label>
                            <input
                                id="horaire-date"
                                type="date"
                                className="custom-select"
                                value={overviewDate}
                                onChange={(e) => setOverviewDate(e.target.value)}
                            />
                        </div>
                    ) : (
                        <div className="custom-select-wrapper">
                            <label className="sr-only" htmlFor="horaire-set">Planning affiché</label>
                            <select
                                id="horaire-set"
                                value={selectedSetId}
                                onChange={(e) => setSelectedSetId(e.target.value)}
                                className="custom-select"
                            >
                                <option value="">Choisir un planning...</option>
                                {setsList.map(set => (
                                    <option key={set.id} value={set.id}>
                                        {set.name || set.libelle || `Horaire #${set.id}`}
                                    </option>
                                ))}
                            </select>
                            <ChevronDown className="select-arrow" />
                        </div>
                    )}
                </div>
            </header>

            {/* Portée : toutes les écoles d'un coup, ou une seule en détail. */}
            {hasMultipleSchools && (
                <div className="horaire-scope" role="tablist" aria-label="Établissement affiché">
                    <button
                        type="button"
                        role="tab"
                        aria-selected={scope === 'all'}
                        className={`scope-tab${scope === 'all' ? ' active' : ''}`}
                        onClick={() => setScope('all')}
                    >
                        Toutes les écoles
                    </button>
                    {schools.map(school => (
                        <button
                            key={school.id}
                            type="button"
                            role="tab"
                            aria-selected={String(scope) === String(school.id)}
                            className={`scope-tab${String(scope) === String(school.id) ? ' active' : ''}`}
                            style={{ '--school-color': school.color }}
                            onClick={() => setScope(String(school.id))}
                        >
                            <span className="scope-dot" aria-hidden="true" />
                            {school.name}
                        </button>
                    ))}
                </div>
            )}

            {isCombined && overview.entries.some(entry => !entry.set) && (
                <p className="horaire-notice">
                    Aucun horaire n'est en vigueur le {overviewDate} pour :{' '}
                    {overview.entries.filter(e => !e.set).map(e => e.school.name).join(', ')}.
                </p>
            )}

            {isMobile ? (
                <>
                    <div className="day-tabs" role="tablist" aria-label="Jour affiché">
                        {activeDays.map(day => (
                            <button
                                key={day.id}
                                type="button"
                                role="tab"
                                aria-selected={day.id === selectedDayId}
                                className={`day-tab${day.id === selectedDayId ? ' active' : ''}`}
                                onClick={() => setSelectedDayId(day.id)}
                            >
                                {day.short}
                            </button>
                        ))}
                    </div>

                    <div className="horaire-day-list">
                        {!dayHasCourse && (
                            <p className="day-empty">Aucun cours {selectedDay ? `le ${selectedDay.name.toLowerCase()}` : 'ce jour'}.</p>
                        )}

                        {dayHasCourse && daySlots.map(({ row, courses }) => (
                            <div
                                key={row.key}
                                className={`day-row${courses.length > 0 ? ' has-course' : ' is-free'}`}
                                style={courses.length > 0 ? courseVars(courses[0]) : undefined}
                            >
                                <span className="day-row-time">{row.libelle}</span>

                                {courses.length > 0 ? (
                                    <div className="day-row-body">
                                        {courses.map(course => (
                                            <div key={course.slot_id || course.id} className="day-row-course">
                                                {isCombined && (
                                                    <span className="course-school" style={{ '--school-color': course.school.color }}>
                                                        {course.school.short_name || course.school.name}
                                                    </span>
                                                )}
                                                <div className="subject-name">{course.subject_name}</div>
                                                <div className="assignment-meta">
                                                    <span className="meta-item"><MapPin size={12} aria-hidden="true" /> {course.room || '—'}</span>
                                                    <span className="meta-item"><User size={12} aria-hidden="true" /> {course.class_name || 'N/A'}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <span className="day-row-free">Libre</span>
                                )}
                            </div>
                        ))}
                    </div>
                </>
            ) : (
                <div className="horaire-grid-card">
                    <div className="grid-responsive-wrapper">
                        <div className="horaire-grid" style={gridStyle}>
                            <div className="grid-header-cell corner"><Clock size={18} /></div>
                            {activeDays.map(day => (
                                <div key={day.id} className="grid-header-cell day-header">
                                    <span className="day-full">{day.name}</span>
                                </div>
                            ))}

                            {gridRows.map((row) => (
                                <React.Fragment key={row.key}>
                                    <div className="time-label-cell">{row.libelle}</div>
                                    {activeDays.map((day) => {
                                        const courses = cellCourses(day.id, row);

                                        return (
                                            <div key={`${day.id}-${row.key}`} className="slot-cell">
                                                {courses.length > 0 ? courses.map(course => (
                                                    <CourseCard
                                                        key={course.slot_id || course.id}
                                                        course={course}
                                                        school={isCombined ? course.school : null}
                                                        compact
                                                    />
                                                )) : (
                                                    <span className="empty-mark"></span>
                                                )}
                                            </div>
                                        );
                                    })}
                                </React.Fragment>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Horaire;
