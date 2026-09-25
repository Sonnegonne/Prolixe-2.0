import React, { useEffect, useState } from 'react';
import { CalendarClock, MapPin } from 'lucide-react';

// « 8:30 » comme « 08:30 » : on compare des minutes, jamais du texte.
const toMinutes = (hhmm) => {
    const [h, m] = String(hhmm || '').split(':');
    const minutes = Number(h) * 60 + Number(m);
    return Number.isFinite(minutes) ? minutes : null;
};

// Un rendez-vous n'a qu'une heure de début : on le considère « passé » une
// heure après, faute de mieux.
const APPOINTMENT_DURATION = 60;

const NOTE_LABELS = {
    'todo':                 'À faire',
    'cap':                  'CAP',
    'conseil-de-classe':    'Conseil de classe',
    'réunions-de-parents':  'Réunion parents',
};

// Minutes écoulées depuis minuit, rafraîchies chaque minute : la journée
// grise ce qui est fini et pointe ce qui est en cours.
const readNow = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const useNowMinutes = () => {
    const [now, setNow] = useState(readNow);
    useEffect(() => {
        const timer = setInterval(() => setNow(readNow()), 60 * 1000);
        return () => clearInterval(timer);
    }, []);
    return now;
};

const CourseItem = ({ course, classes, showSchools, onSlotClick, timing }) => {
    const classInfo = classes.find(c => c.id === course.class_id);
    const borderColor = course.isCancelled ? 'var(--red-danger)' : (course.isExam || course.isHoliday) ? 'var(--accent-orange)' : (course.subject_color || '#ccc');

    let preview = { text: null, className: '' };
    const entry = course.journalEntry;
    if (entry && !course.isCancelled && !course.isExam && !course.isHoliday) {
        const work = entry.actual_work || entry.planned_work;
        preview.text = course.isInterro ? work?.replace('[INTERRO]', '').trim() : work;
        preview.className = entry.actual_work ? 'actual-work' : 'planned-work';
    }

    const classNames = [
        'daily-journal-slot', 'clickable', `is-${timing}`,
        course.isCancelled && 'is-cancelled',
        course.isInterro && 'is-interro',
    ].filter(Boolean).join(' ');

    return (
        <div className={classNames} style={{ borderColor }} onClick={() => onSlotClick(course)}>
            {course.isHoliday ? (
                <div className="cancellation-display holiday-display"><span className="cancellation-icon">🌴</span><p>Vacances</p></div>
            ) : course.isCancelled ? (
                <div className="cancellation-display"><span className="cancellation-icon">🚫</span><p>ANNULÉ — {course.time_label}</p></div>
            ) : (
                <div className="course-summary">
                    <div className="course-info-header">
                        <span className="course-time-display">{course.time_label}</span>
                        {timing === 'now' && <span className="now-badge">En cours</span>}
                        {showSchools && course.school && (
                            <span className="course-school-badge" style={{ backgroundColor: course.school.color }}>
                                {course.school.short_name || course.school.name}
                            </span>
                        )}
                        <span className="course-class-display">{course.class_name || classInfo?.name}</span>
                    </div>
                    <div className="course-details">
                        <div className="course-title-display">{course.subject_name}</div>
                        <div className="course-room-display">{course.room}</div>
                    </div>
                    {preview.text && (
                        <div className={`journal-entry-preview ${preview.className}`}>
                            <p className="preview-text">
                                {course.isInterro && <strong>Interro : </strong>}
                                {preview.text}
                            </p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

const AppointmentItem = ({ note, showSchools, timing }) => {
    const label = NOTE_LABELS[note.state];
    return (
        <div className={`daily-appointment is-${timing}`}>
            <div className="appointment-time">
                <CalendarClock size={16} aria-hidden="true" />
                <span>{String(note.time).slice(0, 5)}</span>
            </div>
            <div className="appointment-body">
                <div className="appointment-tags">
                    <span className="appointment-kind">Rendez-vous</span>
                    {label && <span className="appointment-category">{label}</span>}
                    {timing === 'now' && <span className="now-badge">Maintenant</span>}
                    {showSchools && note.school_name && (
                        <span className="course-school-badge" style={{ backgroundColor: note.school_color }}>
                            {note.school_short_name || note.school_name}
                        </span>
                    )}
                </div>
                <p className="appointment-text">{note.text}</p>
                {note.location && (
                    <span className="appointment-location"><MapPin size={13} aria-hidden="true" /> {note.location}</span>
                )}
            </div>
        </div>
    );
};

const TodayScheduleSection = ({ todaySchedule, appointments = [], holidayInfo, classes, loading, onSlotClick, showSchools = false }) => {
    const now = useNowMinutes();

    if (loading) return <div className="loading-message">Chargement de l'emploi du temps...</div>;

    // Une seule frise : cours et rendez-vous rangés par heure de début. À
    // heure égale, le cours passe devant (le rendez-vous suit souvent).
    const items = [
        ...(holidayInfo ? [] : todaySchedule).map(course => {
            const [start, end] = String(course.time_label || '').split('-').map(toMinutes);
            return { kind: 'course', key: `c-${course.slot_id || course.id}`, start, end: end ?? start, course };
        }),
        ...appointments.map(note => {
            const start = toMinutes(note.time);
            return { kind: 'rdv', key: `n-${note.id}`, start, end: start + APPOINTMENT_DURATION, note };
        }),
    ]
        .filter(item => item.start !== null)
        .sort((a, b) => a.start - b.start || (a.kind === 'course' ? -1 : 1));

    const timingOf = (item) => (item.end <= now ? 'past' : item.start <= now ? 'now' : 'next');

    // Le repère « maintenant » se glisse avant le premier élément pas encore
    // commencé — seulement entre deux éléments, et si rien n'est en cours.
    const nextIndex = items.findIndex(item => item.start > now);
    const showNowLine = nextIndex > 0 && !items.some(item => timingOf(item) === 'now');

    const nowLabel = `${String(Math.floor(now / 60)).padStart(2, '0')}:${String(now % 60).padStart(2, '0')}`;

    return (
        <div className="daily-schedule-section">
            <h2>Votre journée d'aujourd'hui</h2>

            {holidayInfo && (
                <div className="holiday-info">
                    <span className="holiday-icon">🎉</span>
                    <p className="holiday-name">{holidayInfo.name}</p>
                    <p>Profitez de ce jour de vacances !</p>
                </div>
            )}

            {items.length === 0 && !holidayInfo && (
                <p className="daily-empty">Aucun cours ni rendez-vous aujourd'hui.</p>
            )}

            {items.length > 0 && (
                <div className="daily-schedule-list">
                    {items.map((item, index) => (
                        <React.Fragment key={item.key}>
                            {showNowLine && index === nextIndex && (
                                <div className="daily-now-line" aria-label={`Il est ${nowLabel}`}>
                                    <span>{nowLabel}</span>
                                </div>
                            )}
                            {item.kind === 'course' ? (
                                <CourseItem
                                    course={item.course}
                                    classes={classes}
                                    showSchools={showSchools}
                                    onSlotClick={onSlotClick}
                                    timing={timingOf(item)}
                                />
                            ) : (
                                <AppointmentItem note={item.note} showSchools={showSchools} timing={timingOf(item)} />
                            )}
                        </React.Fragment>
                    ))}
                </div>
            )}
        </div>
    );
};

export default TodayScheduleSection;
