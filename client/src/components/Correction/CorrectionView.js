import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
    ChevronsRight,
    Save,
    ArrowLeft,
    CheckCircle,
    UserCheck,
    MessageSquare,
    ClipboardList
} from 'lucide-react';
import { getEvaluationForGrading, saveGrades } from '../../services/EvaluationService';
import { useToast } from '../../hooks/useToast';
import './CorrectionView.scss';

const CommentDisplay = ({ text }) => {
    if (!text) return null;
    const parts = text.split(/(\/\*[\s\S]*?\*\/)/g).filter(Boolean);
    return (
        <div className="comment-display-container">
            {parts.map((part, index) => {
                if (part.startsWith('/*') && part.endsWith('*/')) {
                    return <pre className="comment-block" key={index}>{part.substring(2, part.length - 2)}</pre>;
                }
                return part.split('\n').map((line, lineIndex) => {
                    const key = `${index}-${lineIndex}`;
                    if (line.trim().startsWith('#')) return <div key={key}><b>{line.substring(line.indexOf('#') + 1).trim()}</b></div>;
                    if (line.trim().startsWith('//')) return <div key={key}><code>{line}</code></div>;
                    return <div key={key}>{line || '\u00A0'}</div>;
                });
            })}
        </div>
    );
};

const CorrectionView = () => {
    const { evaluationId } = useParams();
    const [evaluation, setEvaluation] = useState(null);
    const [criteria, setCriteria] = useState([]);
    const [students, setStudents] = useState([]);
    const [grades, setGrades] = useState({});
    const [selectedStudentId, setSelectedStudentId] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const { success, error: showError } = useToast();

    const [editingCommentKey, setEditingCommentKey] = useState(null);
    const [absentStudents, setAbsentStudents] = useState(new Set());

    const fetchData = useCallback(async () => {
        if (!evaluationId) return;
        try {
            setIsLoading(true);
            const response = await getEvaluationForGrading(evaluationId);
            const { evaluation, criteria, students, grades: globalGrades, criteriaGrades } = response.data.data;

            setEvaluation(evaluation);
            setCriteria(criteria);
            setStudents(students);

            if (students.length > 0) setSelectedStudentId(students[0].id);

            const gradesObject = {};
            criteriaGrades.forEach(cg => {
                gradesObject[`${cg.student_id}-${cg.criterion_id}`] = {
                    score: cg.score_obtained,
                    comment: cg.comment || '',
                };
            });

            globalGrades.forEach(g => {
                gradesObject[`global-${g.student_id}`] = { comment: g.comment || '' };
            });

            const absentSet = new Set(globalGrades.filter(g => g.is_absent).map(g => g.student_id));
            setGrades(gradesObject);
            setAbsentStudents(absentSet);
        } catch (err) {
            showError('Impossible de charger la grille de correction.');
        } finally {
            setIsLoading(false);
        }
    }, [evaluationId, showError]);

    useEffect(() => { fetchData(); }, [fetchData]);

    // Groupement des critères par section (ordre d'apparition préservé)
    const groupedCriteria = useMemo(() => {
        const groups = {};
        criteria.forEach(c => {
            const section = c.section_name || 'Général';
            if (!groups[section]) groups[section] = [];
            groups[section].push(c);
        });
        return groups;
    }, [criteria]);

    const studentTotals = useMemo(() => {
        const totals = {};
        students.forEach(student => {
            if (absentStudents.has(student.id)) {
                totals[student.id] = null;
            } else {
                let sum = 0;
                criteria.forEach(c => {
                    const g = grades[`${student.id}-${c.id}`];
                    if (g?.score !== null && g?.score !== undefined && g.score !== '') {
                        const val = parseFloat(g.score);
                        if (!isNaN(val)) sum += val;
                    }
                });
                totals[student.id] = sum;
            }
        });
        return totals;
    }, [students, criteria, grades, absentStudents]);

    const prepareStudentPayload = useCallback((studentId) => {
        const isAbsent = absentStudents.has(studentId);
        const totalScore = studentTotals[studentId] || 0;

        const criteriaScores = criteria.map(criterion => {
            const gradeInfo = grades[`${studentId}-${criterion.id}`] || { score: null, comment: '' };
            return {
                criterion_id: criterion.id,
                score: isAbsent ? null : (gradeInfo.score === '' ? null : parseFloat(gradeInfo.score)),
                comment: isAbsent ? null : gradeInfo.comment
            };
        });

        return {
            student_id: studentId,
            total_score: totalScore,
            is_absent: isAbsent,
            comment: isAbsent ? null : (grades[`global-${studentId}`]?.comment || null),
            criteria_scores: criteriaScores
        };
    }, [absentStudents, criteria, grades, studentTotals]);

    const handleSaveCurrentAndNext = async () => {
        if (!selectedStudentId) return;
        setIsSaving(true);

        try {
            const payload = [prepareStudentPayload(selectedStudentId)];
            await saveGrades(evaluationId, payload, { is_corrected: true, is_completed: true });

            const currentIndex = students.findIndex(s => s.id === selectedStudentId);
            if (currentIndex < students.length - 1) {
                setSelectedStudentId(students[currentIndex + 1].id);
                window.scrollTo({ top: 0, behavior: 'smooth' });
            } else {
                success('Dernier élève enregistré !');
            }
        } catch (err) {
            showError('Erreur lors de la sauvegarde de cet élève.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleGradeChange = (studentId, criterionId, value, maxPoints) => {
        const key = `${studentId}-${criterionId}`;
        let newScore = value === '' ? null : parseFloat(value);

        if (newScore !== null && !isNaN(newScore)) {
            newScore = Math.max(0, Math.min(newScore, parseFloat(maxPoints)));
        }

        setGrades(prev => ({
            ...prev,
            [key]: { ...(prev[key] || { comment: '' }), score: newScore }
        }));

        if (newScore !== null) {
            setAbsentStudents(prev => {
                const next = new Set(prev);
                next.delete(studentId);
                return next;
            });
        }
    };

    if (isLoading) return <div className="loading-fullscreen">Chargement...</div>;
    if (!evaluation) return <div>Évaluation introuvable.</div>;

    const isSelectedStudentAbsent = absentStudents.has(selectedStudentId);
    const isLastStudent = students.findIndex(s => s.id === selectedStudentId) === students.length - 1;

    return (
        <div className="correction-view-focused">
            <div className="correction-header">
                <div className="header-title">
                    <Link to="/correction" className="back-link"><ArrowLeft size={18}/> Retour</Link>
                    <h1>{evaluation.title}</h1>
                    <p>{evaluation.class_name} — {new Date(evaluation.evaluation_date).toLocaleDateString()}</p>
                </div>
                <button
                    onClick={() => saveGrades(evaluationId, students.map(s => prepareStudentPayload(s.id)), { is_corrected: true, is_completed: true }).then(() => success('Classe sauvegardée'))}
                    className="btn-secondary"
                >
                    <Save size={18} /> Sauvegarder tout
                </button>
            </div>

            <div className="correction-layout">
                <div className="student-correction-panel">
                    <div className="student-selector-bar">
                        <div className="select-wrapper">
                            <UserCheck size={18} />
                            <select
                                value={selectedStudentId || ''}
                                onChange={(e) => setSelectedStudentId(Number(e.target.value))}
                            >
                                {students.map(s => <option key={s.id} value={s.id}>{s.lastname} {s.firstname}</option>)}
                            </select>
                        </div>
                        <label className="absent-checkbox">
                            <input
                                type="checkbox"
                                checked={isSelectedStudentAbsent}
                                onChange={(e) => {
                                    const next = new Set(absentStudents);
                                    if (e.target.checked) next.add(selectedStudentId);
                                    else next.delete(selectedStudentId);
                                    setAbsentStudents(next);
                                }}
                            /> <span>Absent</span>
                        </label>
                    </div>

                    <div className={`global-student-comment ${isSelectedStudentAbsent ? 'disabled' : ''}`}>
                        <div className="section-title">
                            <MessageSquare size={16} />
                            <h4>Commentaire général</h4>
                        </div>
                        {editingCommentKey === `global-${selectedStudentId}` ? (
                            <textarea
                                className="comment-textarea global-textarea"
                                autoFocus
                                value={grades[`global-${selectedStudentId}`]?.comment || ''}
                                onBlur={() => setEditingCommentKey(null)}
                                onChange={(e) => setGrades(prev => ({
                                    ...prev,
                                    [`global-${selectedStudentId}`]: { comment: e.target.value }
                                }))}
                                disabled={isSelectedStudentAbsent}
                            />
                        ) : (
                            <div
                                className="comment-display-wrapper global-preview"
                                onClick={() => !isSelectedStudentAbsent && setEditingCommentKey(`global-${selectedStudentId}`)}
                            >
                                {grades[`global-${selectedStudentId}`]?.comment ? (
                                    <CommentDisplay text={grades[`global-${selectedStudentId}`].comment} />
                                ) : (
                                    <span className="placeholder">+ Ajouter un bilan pour cet élève...</span>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="criteria-list">
                        <div className="section-title">
                            <ClipboardList size={16} />
                            <h4>Critères d'évaluation</h4>
                        </div>

                        {Object.entries(groupedCriteria).map(([section, sectionCriteria]) => (
                            <div key={section} className="criteria-section">
                                <h4 className="section-divider">{section}</h4>

                                {sectionCriteria.map(criterion => {
                                    const key = `${selectedStudentId}-${criterion.id}`;
                                    const gradeInfo = grades[key] || { score: '', comment: '' };
                                    const isEditing = editingCommentKey === key;

                                    return (
                                        <div className={`criterion-row ${isSelectedStudentAbsent ? 'disabled' : ''}`} key={criterion.id}>
                                            <div className="criterion-main">
                                                <span className="criterion-name">{criterion.name}</span>
                                                <div className="grade-input-group">
                                                    <input
                                                        type="number"
                                                        step="0.25"
                                                        value={isSelectedStudentAbsent ? '' : gradeInfo.score ?? ''}
                                                        disabled={isSelectedStudentAbsent}
                                                        onChange={(e) => handleGradeChange(selectedStudentId, criterion.id, e.target.value, criterion.max_points)}
                                                    />
                                                    <span className="max-points">/ {criterion.max_points}</span>
                                                </div>
                                            </div>

                                            <div className="criterion-comment">
                                                {isEditing ? (
                                                    <textarea
                                                        autoFocus
                                                        value={gradeInfo.comment}
                                                        onBlur={() => setEditingCommentKey(null)}
                                                        onChange={(e) => setGrades(prev => ({
                                                            ...prev, [key]: { ...prev[key], comment: e.target.value }
                                                        }))}
                                                    />
                                                ) : (
                                                    <div className="comment-preview" onClick={() => !isSelectedStudentAbsent && setEditingCommentKey(key)}>
                                                        {gradeInfo.comment ? <CommentDisplay text={gradeInfo.comment} /> : <span>+ Commentaire critère</span>}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                    </div>

                    <div className="navigation-footer">
                        <div className="student-total-display">
                            <span>Total :</span>
                            <strong>
                                {isSelectedStudentAbsent
                                    ? 'ABS'
                                    : `${Number(studentTotals[selectedStudentId] || 0).toFixed(2)} / ${evaluation.max_score}`
                                }
                            </strong>
                        </div>
                        <button
                            onClick={handleSaveCurrentAndNext}
                            className="btn-next-student"
                            disabled={isSaving}
                        >
                            {isSaving ? 'Enregistrement...' : (isLastStudent ? 'Terminer la session' : 'Suivant')}
                            {!isSaving && <ChevronsRight size={20} />}
                        </button>
                    </div>
                </div>

                <div className="class-summary-panel">
                    <h3>Liste de la classe</h3>
                    <div className="summary-list">
                        {students.map(s => (
                            <div
                                key={s.id}
                                className={`summary-item ${s.id === selectedStudentId ? 'active' : ''}`}
                                onClick={() => setSelectedStudentId(s.id)}
                            >
                                <span className="student-name">{s.lastname} {s.firstname}</span>
                                <span className="student-score">
                                    {studentTotals[s.id] === null ? 'ABS' : Number(studentTotals[s.id]).toFixed(1)}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CorrectionView;