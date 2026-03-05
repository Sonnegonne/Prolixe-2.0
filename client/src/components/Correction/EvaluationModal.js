import React, { useState, useEffect } from 'react';
import { useClasses } from '../../hooks/useClasses';
import { useJournal } from '../../hooks/useJournal';
import { getEvaluationTemplates, getEvaluationById } from '../../services/EvaluationService';
import { useToast } from '../../hooks/useToast';
import './EvaluationModal.scss';
import { TextField, MenuItem, Select, FormControl, InputLabel } from "@mui/material";
import {useSubjects} from "../../hooks/useSubjects";

const EvaluationModal = ({ isOpen, onClose, onSave, evaluation, evaluationToCopy }) => {
    const { currentJournal } = useJournal();
    const journalId = currentJournal?.id;
    const { classes } = useClasses(journalId);
    const { error: showError } = useToast();
    const { subjects, loadSubjects, loading: loadingSubs } = useSubjects();

    useEffect(() => {
        if (isOpen && journalId) {
            loadSubjects(journalId);
        }
    }, [isOpen, journalId, loadSubjects]);


    // États du formulaire
    const [name, setName] = useState('');
    const [classId, setClassId] = useState('');
    const [subjectId, setSubjectId] = useState(''); // Ajout de l'état pour la matière
    const [date, setDate] = useState('');
    const [criteria, setCriteria] = useState([{ label: '', max_score: '' }]);
    const [folder, setFolder] = useState('');

    const [isSaving, setIsSaving] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [templates, setTemplates] = useState([]);
    const [selectedTemplateId, setSelectedTemplateId] = useState('');

    useEffect(() => {
        if (!isOpen) {
            setName('');
            setClassId('');
            setSubjectId('');
            setDate('');
            setCriteria([{ label: '', max_score: '' }]);
            setSelectedTemplateId('');
            setTemplates([]);
            setIsLoading(false);
            setFolder('');
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;

        const loadData = async () => {
            setIsLoading(true);
            try {
                if (evaluation || evaluationToCopy) {
                    const targetId = evaluation?.id || evaluationToCopy?.id;
                    const response = await getEvaluationById(targetId);
                    const data = response.data.data;

                    setName(evaluationToCopy ? `Copie de ${data.title}` : data.title);
                    setClassId(data.class_id);
                    setSubjectId(data.subject_id || ''); // Charger la matière existante
                    setFolder(data.folder || '');
                    setDate(evaluation ? new Date(data.evaluation_date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]);

                    if (data.criteria?.length > 0) {
                        setCriteria(data.criteria.map(c => ({
                            id: evaluation ? c.id : null,
                            label: c.name,
                            max_score: c.max_points
                        })));
                    }
                } else {
                    const response = await getEvaluationTemplates();
                    setTemplates(response.data.data || []);
                    setDate(new Date().toISOString().split('T')[0]);
                    // Par défaut, si le journal n'a qu'une matière, on la sélectionne
                    if (subjects.length === 1) setSubjectId(subjects[0].id);
                }
            } catch (err) {
                showError("Erreur lors du chargement.");
            } finally {
                setIsLoading(false);
            }
        };
        loadData();
    }, [isOpen, evaluation, evaluationToCopy, subjects.length]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!subjectId) return showError("Veuillez sélectionner une matière.");

        setIsSaving(true);
        const totalMaxScore = criteria.reduce((sum, c) => sum + parseFloat(c.max_score || 0), 0);

        const payload = {
            title: name,
            class_id: classId,
            journal_id: journalId,
            subject_id: subjectId, // Envoi du subject_id indispensable
            evaluation_date: date,
            max_score: totalMaxScore,
            global_comment: "",
            folder: folder,
            criteria: criteria
                .filter(c => c.label && c.max_score)
                .map((c, index) => ({
                    id: c.id || null,
                    name: c.label,
                    max_points: parseFloat(c.max_score),
                    display_order: index
                }))
        };

        try {
            await onSave(payload);
            onClose();
        } catch (err) {
            showError("Erreur lors de la sauvegarde.");
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="modal">
                <div className="modal-header">
                    <h3>{evaluation ? "Modifier" : evaluationToCopy ? "Copier" : "Nouvelle"} Évaluation</h3>
                    <button className="modal-close" onClick={onClose}>×</button>
                </div>

                {isLoading ? <div className="loading-modal">Chargement...</div> : (
                    <form className="class-form" onSubmit={handleSubmit}>
                        {!evaluation && !evaluationToCopy && (
                            <div className="form-group">
                                <label>Modèle</label>
                                <select value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)}>
                                    <option value="">-- Partir de zéro --</option>
                                    {templates.map(t => (
                                        <option key={t.id} value={t.id}>{t.title} ({t.max_score} pts)</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        <div className="form-group">
                            <label>Titre</label>
                            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
                        </div>

                        <div className="form-row">
                            <div className="form-group">
                                <label>Matière</label>
                                <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} required>
                                    <option value="">-- Sélectionner --</option>
                                    {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label>Classe</label>
                                <select value={classId} onChange={(e) => setClassId(e.target.value)} required disabled={!!evaluation}>
                                    <option value="">-- Choisir --</option>
                                    {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                            </div>
                        </div>

                        <div className="form-group">
                            <label>Date</label>
                            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
                        </div>

                        <h4>Critères</h4>
                        <div className="criteria-list">
                            {criteria.map((criterion, index) => (
                                <div className="criterion-row form-group" key={index}>
                                    <TextField
                                        fullWidth multiline rows={1} placeholder="Nom"
                                        value={criterion.label}
                                        onChange={(e) => {
                                            const newC = [...criteria];
                                            newC[index].label = e.target.value;
                                            setCriteria(newC);
                                        }}
                                        required
                                    />
                                    <input
                                        type="number" step="0.25" placeholder="Pts"
                                        value={criterion.max_score}
                                        onChange={(e) => {
                                            const newC = [...criteria];
                                            newC[index].max_score = e.target.value;
                                            setCriteria(newC);
                                        }}
                                        required
                                        style={{ width: '80px' }}
                                    />
                                    <button type="button" className="btn-delete" onClick={() => setCriteria(criteria.filter((_, i) => i !== index))} disabled={criteria.length <= 1}>×</button>
                                </div>
                            ))}
                        </div>

                        <button type="button" className="btn-add-criterion" onClick={() => setCriteria([...criteria, { label: '', max_score: '' }])}>+ Critère</button>

                        <div className="form-actions">
                            <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
                            <button type="submit" className="btn-primary" disabled={isSaving}>{isSaving ? 'Sauvegarde...' : 'Sauvegarder'}</button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
};

export default EvaluationModal;