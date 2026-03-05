import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
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
            // 1. Charger les notes par critère
            criteriaGrades.forEach(cg => {
                const key = `${cg.student_id}-${cg.criterion_id}`;
                gradesObject[key] = {
                    score: cg.score_obtained,
                    comment: cg.comment || '',
                };
            });

            // 2. Charger les commentaires globaux (par élève)
            globalGrades.forEach(g => {
                gradesObject[`global-${g.student_id}`] = {
                    comment: g.comment || ''
                };
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

    const handleSave = async () => {
        setIsSaving(true);

        const studentGrades = students.map(student => {
            const isAbsent = absentStudents.has(student.id);
            let totalScore = 0;

            const criteriaScores = criteria.map(criterion => {
                const gradeInfo = grades[`${student.id}-${criterion.id}`] || { score: null, comment: '' };
                if (!isAbsent && gradeInfo.score !== null) totalScore += gradeInfo.score;

                return {
                    criterion_id: criterion.id,
                    score: isAbsent ? null : gradeInfo.score,
                    comment: isAbsent ? null : gradeInfo.comment
                };
            });

            return {
                student_id: student.id,
                total_score: totalScore,
                is_absent: isAbsent,
                // On récupère ici le commentaire global de l'élève
                comment: isAbsent ? null : (grades[`global-${student.id}`]?.comment || null),
                criteria_scores: criteriaScores
            };
        });

        try {
            await saveGrades(evaluationId, studentGrades, { is_corrected: true, is_completed: true });
            success('Correction enregistrée avec succès !');
        } catch (err) {
            showError('Erreur lors de la sauvegarde.');
        } finally {
            setIsSaving(false);
        }
    };

    const studentTotals = useMemo(() => {
        const totals = {};
        students.forEach(student => {
            if (absentStudents.has(student.id)) {
                totals[student.id] = null;
            } else {
                let sum = 0;
                criteria.forEach(c => {
                    const g = grades[`${student.id}-${c.id}`];
                    if (g?.score !== null && g?.score !== undefined) sum += g.score;
                });
                totals[student.id] = sum;
            }
        });
        return totals;
    }, [students, criteria, grades, absentStudents]);

    if (isLoading) return <div className="loading-fullscreen">Chargement...</div>;
    if (!evaluation) return <div>Évaluation introuvable.</div>;

    const totalMaxScore = evaluation.max_score;
    const isSelectedStudentAbsent = absentStudents.has(selectedStudentId);

    return (
        <div className="correction-view-focused">
            <div className="correction-header">
                <div className="header-title">
                    <Link to="/correction" className="back-link">← Retour</Link>
                    <h1>{evaluation.title}</h1>
                    <p>{evaluation.class_name} — {new Date(evaluation.evaluation_date).toLocaleDateString()}</p>
                </div>
                <button onClick={handleSave} className="btn-primary save-button" disabled={isSaving}>
                    {isSaving ? 'Sauvegarde...' : '💾 Sauvegarder'}
                </button>
            </div>

            <div className="correction-layout">
                <div className="student-correction-panel">
                    <div className="student-selector-bar">
                        <select
                            value={selectedStudentId || ''}
                            onChange={(e) => setSelectedStudentId(Number(e.target.value))}
                        >
                            {students.map(s => <option key={s.id} value={s.id}>{s.lastname} {s.firstname}</option>)}
                        </select>
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
                            /> Absent
                        </label>
                    </div>

                    <div className={`global-student-comment ${isSelectedStudentAbsent ? 'disabled' : ''}`}>
                        <h4>Commentaire général pour l'élève</h4>
                        {editingCommentKey === `global-${selectedStudentId}` ? (
                            <textarea
                                className="comment-textarea global-textarea"
                                autoFocus
                                placeholder="Bilan de l'interrogation..."
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
                                    <button type="button" className="btn-add-comment" disabled={isSelectedStudentAbsent}>
                                        + Ajouter un commentaire général
                                    </button>
                                )}
                            </div>
                        )}
                    </div>


                    <div className="criteria-list">
                        {criteria.map(criterion => {
                            const key = `${selectedStudentId}-${criterion.id}`;
                            const gradeInfo = grades[key] || { score: '', comment: '' };
                            const isEditing = editingCommentKey === key;

                            return (
                                <div className={`criterion-row ${isSelectedStudentAbsent ? 'disabled' : ''}`} key={criterion.id}>
                                    <div className="criterion-main">
                                        <div className="criterion-info">
                                            <span className="criterion-name">{criterion.name}</span>
                                        </div>
                                        <div className="grade-input-group">
                                            <input
                                                type="number"
                                                step="0.25"
                                                value={isSelectedStudentAbsent ? '' : gradeInfo.score ?? ''}
                                                placeholder="-"
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

                        <div className="student-total-display">
                            <span>Total Élève :</span>
                            <strong>
                                {isSelectedStudentAbsent ? 'ABS' : (studentTotals[selectedStudentId] || 0).toFixed(2)} / {totalMaxScore}
                            </strong>
                        </div>
                    </div>
                </div>

                <div className="class-summary-panel">
                    <h3>Classe</h3>
                    <div className="summary-list">
                        {students.map(s => (
                            <div
                                key={s.id}
                                className={`summary-item ${s.id === selectedStudentId ? 'active' : ''}`}
                                onClick={() => setSelectedStudentId(s.id)}
                            >
                                <span>{s.lastname}</span>
                                <strong>{studentTotals[s.id] === null ? 'ABS' : studentTotals[s.id].toFixed(1)}</strong>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="bottom-save-container">
                <button onClick={handleSave} className="btn-primary save-button" disabled={isSaving}>
                    {isSaving ? 'Sauvegarde...' : '💾 Sauvegarder'}
                </button>
            </div>
        </div>
    );
};

export default CorrectionView;