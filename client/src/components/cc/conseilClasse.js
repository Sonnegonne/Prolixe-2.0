import React, { useState, useMemo, useRef, useLayoutEffect, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useJournal } from '../../hooks/useJournal';
import { useClasses } from '../../hooks/useClasses';
import { useConseilSessions } from '../../hooks/useConseilSession';
import { useConseilDeClasse } from '../../hooks/useCC';
import { Settings, Users, Calendar, Maximize2, X, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import './conseilClasse.scss';

// --- 1. SOUS-COMPOSANTS UTILITAIRES ---

const SavingIndicator = ({ status }) => {
    if (status === 'pending') return <span className="saving-indicator pending">✏️ Modifié</span>;
    if (status === 'saving') return <span className="saving-indicator">💾 Sauvegarde...</span>;
    if (status === 'saved') return <span className="saving-indicator saved"> ✅ Enregistré !</span>;
    if (status === 'error') return <span className="saving-indicator error">❌ Erreur</span>;
    return null;
};

const DecisionSelect = ({ value, onChange }) => (
    <select value={value || 'AO-A'} onChange={e => onChange(e.target.value)}>
        <option value="AO-A">AO-A</option>
        <option value="AO-B">AO-B</option>
        <option value="AO-C">AO-C</option>
    </select>
);

// Zone de texte qui grandit avec son contenu (jusqu'à la hauteur max du CSS).
const AutoTextarea = ({ value, ...props }) => {
    const ref = useRef(null);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight + 2}px`;
    }, [value]);
    return <textarea ref={ref} value={value} {...props} />;
};

const StudentRow = React.memo(({ student, onStudentChange, savingStatus, onExpand }) => (
    <tr className="student-table__row">
        <td data-label="Élève">{`${student.firstname} ${student.lastname}`}</td>
        <td data-label="Avis et notes">
            <div className="notes-cell">
                <AutoTextarea
                    value={student.notes || ''}
                    onChange={e => onStudentChange(student.id, 'notes', e.target.value)}
                    placeholder="Synthèse, encouragements..."
                    rows={3}
                />
                <button
                    type="button"
                    className="expand-btn"
                    onClick={() => onExpand(student.id)}
                    title="Voir en grand"
                >
                    <Maximize2 size={14} /> Voir en grand
                </button>
            </div>
        </td>
        <td data-label="Décision proposée">
            <DecisionSelect value={student.decision} onChange={v => onStudentChange(student.id, 'decision', v)} />
        </td>
        <td data-label="Statut">
            <SavingIndicator status={savingStatus} />
        </td>
    </tr>
));

const StudentTable = ({ students, onStudentChange, savingStatus, onExpand }) => (
    <table className="student-table">
        <colgroup>
            <col className="col-name" />
            <col className="col-notes" />
            <col className="col-decision" />
            <col className="col-status" />
        </colgroup>
        <thead>
        <tr>
            <th>Élève</th>
            <th>Avis et notes du conseil</th>
            <th>Décision proposée</th>
            <th>Statut</th>
        </tr>
        </thead>
        <tbody>
        {students.map(student => (
            <StudentRow
                key={student.id}
                student={student}
                onStudentChange={onStudentChange}
                savingStatus={savingStatus[student.id]}
                onExpand={onExpand}
            />
        ))}
        </tbody>
    </table>
);

// Vue en grand : un élève à la fois, grande zone de texte, navigation qui enregistre.
const StudentFocus = ({ students, index, onStudentChange, savingStatus, onNavigate, onClose }) => {
    const student = students[index];
    const textareaRef = useRef(null);
    const isFirst = index === 0;
    const isLast = index === students.length - 1;

    // Curseur en fin de texte à chaque changement d'élève.
    useEffect(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        const end = el.value.length;
        el.setSelectionRange(end, end);
        el.scrollTop = el.scrollHeight;
    }, [student?.id]);

    useEffect(() => {
        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); onClose(); }
            else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                if (isLast) onClose(); else onNavigate(index + 1);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [index, isLast, onClose, onNavigate]);

    // Pas de défilement de la page derrière la vue en grand.
    useEffect(() => {
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, []);

    if (!student) return null;
    const notes = student.notes || '';

    return createPortal(
        <div className="cc-focus-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="cc-focus" role="dialog" aria-modal="true" aria-label={`Avis pour ${student.firstname} ${student.lastname}`}>
                <header className="cc-focus__header">
                    <div>
                        <span className="cc-focus__position">Élève {index + 1} / {students.length}</span>
                        <h3>{student.firstname} {student.lastname}</h3>
                    </div>
                    <div className="cc-focus__header-right">
                        <SavingIndicator status={savingStatus[student.id]} />
                        <button type="button" className="cc-focus__close" onClick={onClose} title="Fermer (Échap)">
                            <X size={20} />
                        </button>
                    </div>
                </header>

                <textarea
                    ref={textareaRef}
                    className="cc-focus__textarea"
                    value={notes}
                    onChange={e => onStudentChange(student.id, 'notes', e.target.value)}
                    placeholder="Synthèse, encouragements..."
                />

                <footer className="cc-focus__footer">
                    <div className="cc-focus__meta">
                        <label>
                            Décision proposée
                            <DecisionSelect value={student.decision} onChange={v => onStudentChange(student.id, 'decision', v)} />
                        </label>
                        <span className="cc-focus__count">{notes.length} caractère{notes.length > 1 ? 's' : ''}</span>
                    </div>
                    <div className="cc-focus__nav">
                        <button type="button" className="nav-btn" onClick={() => onNavigate(index - 1)} disabled={isFirst}>
                            <ChevronLeft size={18} /> Précédent
                        </button>
                        {isLast ? (
                            <button type="button" className="nav-btn primary" onClick={onClose} title="Ctrl+Entrée">
                                <Check size={18} /> Enregistrer et fermer
                            </button>
                        ) : (
                            <button type="button" className="nav-btn primary" onClick={() => onNavigate(index + 1)} title="Ctrl+Entrée">
                                Enregistrer · élève suivant <ChevronRight size={18} />
                            </button>
                        )}
                    </div>
                </footer>
            </div>
        </div>,
        document.body
    );
};

// --- 2. COMPOSANT PRINCIPAL ---

const ConseilDeClasse = () => {
    const { currentJournal } = useJournal();
    const journalId = currentJournal?.id;

    const [selectedSessionId, setSelectedSessionId] = useState('');
    const [selectedClassId, setSelectedClassId] = useState('');
    const [isManageMode, setIsManageMode] = useState(false);
    const [newSessionName, setNewSessionName] = useState('');

    const { classes, loading: loadingClasses } = useClasses(journalId);
    const { sessions, addSession, removeSession, loading: loadingSessions } = useConseilSessions(journalId);
    const { students, loading: loadingStudents, savingStatus, handleStudentChange, saveStudent } = useConseilDeClasse(selectedSessionId, selectedClassId);

    // Élève ouvert dans la vue en grand (id, pour rester juste si la liste se recharge).
    const [focusId, setFocusId] = useState(null);
    const focusIndex = students.findIndex(s => s.id === focusId);

    useEffect(() => { setFocusId(null); }, [selectedSessionId, selectedClassId]);

    const navigateFocus = useCallback((nextIndex) => {
        if (focusId != null) saveStudent(focusId);
        const next = students[nextIndex];
        if (next) setFocusId(next.id);
    }, [focusId, saveStudent, students]);

    const closeFocus = useCallback(() => {
        if (focusId != null) saveStudent(focusId);
        setFocusId(null);
    }, [focusId, saveStudent]);

    const content = useMemo(() => {
        if (!selectedSessionId || !selectedClassId) {
            return <div className="placeholder-text">Sélectionnez une période et une classe pour afficher les élèves.</div>;
        }
        if (loadingStudents) return <p>Chargement des élèves...</p>;
        if (students?.length === 0) return <p className="placeholder-text">Aucun élève trouvé.</p>;

        return <StudentTable students={students} onStudentChange={handleStudentChange} savingStatus={savingStatus} onExpand={setFocusId} />;
    }, [selectedSessionId, selectedClassId, loadingStudents, students, handleStudentChange, savingStatus]);

    return (
        <div className="conseil-de-classe">
            <header className="page-header">
                <div className="header-top">
                    <h2>Conseils de Classe</h2>
                    <button className="add-glass-btn" onClick={() => setIsManageMode(!isManageMode)}>
                        <Settings size={18} />
                        {isManageMode ? "Retour à la saisie" : "Gérer les périodes"}
                    </button>
                </div>

                {!isManageMode && (
                    <div className="selectors-container">
                        <div className="input-group">
                            <label><Calendar size={14}/> Période</label>
                            <select value={selectedSessionId} onChange={e => setSelectedSessionId(e.target.value)}>
                                <option value="">-- Choisir (ex: Noël) --</option>
                                {sessions.map(s => <option key={s.id} value={s.id}>{s.libelle}</option>)}
                            </select>
                        </div>

                        <div className="input-group">
                            <label><Users size={14}/> Classe</label>
                            <select value={selectedClassId} onChange={e => setSelectedClassId(e.target.value)}>
                                <option value="">-- Choisir une classe --</option>
                                {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                        </div>
                    </div>
                )}
            </header>

            <main className="conseil-content">
                {isManageMode ? (
                    <div className="session-manager-view">
                        <h3>Configuration des conseils de l'année</h3>
                        <div className="add-session-form">
                            <input
                                placeholder="Nom de la session (ex: Bilan de Pâques)"
                                value={newSessionName}
                                onChange={e => setNewSessionName(e.target.value)}
                            />
                            <button className="confirm-btn" onClick={() => { addSession(newSessionName); setNewSessionName(''); }}>
                                + Créer la session
                            </button>
                        </div>
                        <div className="schedule-grid">
                            {sessions.map((s, idx) => (
                                <div key={s.id} className="schedule-card">
                                    <div className="card-index">#{idx + 1}</div>
                                    <div className="card-info">
                                        <span className="time">{s.libelle}</span>
                                    </div>
                                    <div className="card-actions">
                                        <button className="action-btn delete" onClick={() => removeSession(s.id)}>🗑️</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    content
                )}
            </main>

            {!isManageMode && focusIndex !== -1 && (
                <StudentFocus
                    students={students}
                    index={focusIndex}
                    onStudentChange={handleStudentChange}
                    savingStatus={savingStatus}
                    onNavigate={navigateFocus}
                    onClose={closeFocus}
                />
            )}
        </div>
    );
};

// --- 3. EXPORTATION ---
export default ConseilDeClasse;
