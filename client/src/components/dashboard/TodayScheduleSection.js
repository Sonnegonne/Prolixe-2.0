import React from 'react';

const TodayScheduleSection = ({ todaySchedule, holidayInfo, getClassColor, classes, loading, onSlotClick }) => {

    if (loading) return <div className="loading-message">Chargement de l'emploi du temps...</div>;

    if (holidayInfo) {
        return (
            <div className="daily-schedule-section">
                <h2>Votre journée d'aujourd'hui</h2>
                <div className="holiday-info">
                    <span className="holiday-icon">🎉</span>
                    <p className="holiday-name">{holidayInfo.name}</p>
                    <p>Profitez de ce jour de vacances !</p>
                </div>
            </div>
        );
    }

    if (!todaySchedule || todaySchedule.length === 0) {
        return (
            <div className="daily-schedule-section">
                <h2>Votre journée d'aujourd'hui</h2>
                <p>Aucun cours n'est prévu pour aujourd'hui.</p>
            </div>
        );
    }

    const sortedSchedule = [...todaySchedule].sort((a, b) =>
        parseInt(a.time_slot_id) - parseInt(b.time_slot_id)
    );

    return (
        <div className="daily-schedule-section">
            <h2>Votre journée d'aujourd'hui</h2>
            <div className="daily-schedule-list">
                {sortedSchedule.map(course => {
                    const classInfo = classes.find(c => c.id === course.class_id);
                    const borderColor = course.isCancelled ? 'var(--red-danger)' : (course.isExam || course.isHoliday) ? 'var(--accent-orange)' : (course.subject_color || '#ccc');

                    let preview = { text: null, className: '' };
                    const entry = course.journalEntry;
                    if (entry && !course.isCancelled && !course.isExam && !course.isHoliday) {
                        const work = entry.actual_work || entry.planned_work;
                        preview.text = course.isInterro ? work?.replace('[INTERRO]', '').trim() : work;
                        preview.className = entry.actual_work ? 'actual-work' : 'planned-work';
                    }

                    return (
                        <div key={course.slot_id || course.id}
                             className="daily-journal-slot clickable"
                             style={{ borderColor }}
                             onClick={() => onSlotClick(course)}>

                            {course.isHoliday ? (
                                <div className="cancellation-display holiday-display"><span className="cancellation-icon">🌴</span><p>Vacances</p></div>
                            ) : course.isCancelled ? (
                                <div className="cancellation-display"><span className="cancellation-icon">🚫</span><p>ANNULÉ</p></div>
                            ) : (
                                <div className="course-summary">
                                    <div className="course-info-header">
                                        <span className="course-time-display">{course.time_label}</span>
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
                })}
            </div>
        </div>
    );
};

export default TodayScheduleSection;