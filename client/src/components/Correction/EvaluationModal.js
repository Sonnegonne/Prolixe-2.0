import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { X, Plus, Save, Copy, ListOrdered, ListChecks } from 'lucide-react';
import { useJournal } from '../../hooks/useJournal';
import ClassService from '../../services/ClassService';
import { getEvaluationTemplates, getEvaluationById } from '../../services/EvaluationService'; // Import des services
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy
} from '@dnd-kit/sortable';
import SortableCriterion from './SortableCriterion';
import './EvaluationModal.scss';
import { useSubjects } from "../../hooks/useSubjects";

// Une interro « sans critères » = une liste de critères nommés Q1, Q2, ...
const QUESTION_NAME = /^Q\d+$/;
const newTempId = () => Math.random().toString(36).substr(2, 9);
const looksLikeQuestions = (criteria) =>
    criteria.length > 0 && criteria.every(c => QUESTION_NAME.test((c.name || '').trim()));
const makeQuestion = (n, points) => ({
    tempId: newTempId(), name: `Q${n}`, section_name: 'Général', max_points: points
});

const EvaluationModal = ({ isOpen, onClose, onSave, evaluation, evaluationToCopy }) => {
    const { currentJournal } = useJournal();
    const [classes, setClasses] = useState([]);
    const { subjects, loadSubjects } = useSubjects();

    // États pour la gestion des templates
    const [templates, setTemplates] = useState([]);
    const [selectedTemplateId, setSelectedTemplateId] = useState('');
    const [isLoadingTemplate, setIsLoadingTemplate] = useState(false);

    const [formData, setFormData] = useState({
        title: '',
        class_id: '',
        subject_id: '',
        evaluation_date: new Date().toISOString().split('T')[0],
        folder: '',
        criteria: []
    });

    const totalMaxScore = useMemo(() => {
        return formData.criteria.reduce((sum, criterion) => {
            const points = parseFloat(criterion.max_points) || 0;
            return sum + points;
        }, 0);
    }, [formData.criteria]);

    const [customSectionFlags, setCustomSectionFlags] = useState({});

    // 'criteria' = grille détaillée ; 'questions' = juste un nombre de questions + points
    const [mode, setMode] = useState('criteria');
    const [defaultPoints, setDefaultPoints] = useState(2);

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    // Initialisation et chargement des templates
    useEffect(() => {
        if (!isOpen || !currentJournal?.id) return;

        ClassService.getClasses(currentJournal.id)
            .then(res => setClasses(res.data.data))
            .catch(err => console.error("Erreur chargement classes", err));

        loadSubjects(currentJournal.id);

        // Charger la liste des évaluations disponibles comme modèles
        getEvaluationTemplates()
            .then(res => setTemplates(res.data.data || []))
            .catch(err => console.error("Erreur templates", err));

        if (evaluation) {
            // Mode Édition
            fillFormFromData(evaluation);
        } else if (evaluationToCopy) {
            // Mode Copie directe
            fillFormFromData(evaluationToCopy, true);
        } else {
            // Mode Nouveau
            const initTempId = 'init-1';
            setFormData({
                title: '',
                class_id: '',
                subject_id: '',
                evaluation_date: new Date().toISOString().split('T')[0],
                max_score: 20,
                folder: '',
                criteria: [{ tempId: initTempId, name: '', section_name: 'Général', max_points: 5 }]
            });
            setCustomSectionFlags({ [initTempId]: false });
            setSelectedTemplateId('');
            setMode('criteria');
        }
    }, [isOpen, evaluation, evaluationToCopy, currentJournal]);

    // Fonction utilitaire pour mapper les critères et remplir le formulaire
    const fillFormFromData = (data, isCopy = false) => {
        const mappedCriteria = (data.criteria || []).map(c => ({
            ...c,
            id: isCopy ? null : c.id, // On reset l'ID si c'est une copie/template
            name: c.name || c.label || '',
            max_points: c.max_points ?? c.max_score ?? 0,
            section_name: c.section_name || 'Général',
            tempId: Math.random().toString(36).substr(2, 9)
        }));

        const flags = {};
        mappedCriteria.forEach(c => { flags[c.tempId] = false; });

        setFormData(prev => ({
            ...data,
            id: isCopy ? null : data.id,
            title: isCopy ? `${data.title || data.name} (Copie)` : (data.title || data.name),
            subject_id: data.subject_id || '',
            evaluation_date: isCopy ? new Date().toISOString().split('T')[0] : (data.evaluation_date?.split('T')[0]),
            criteria: mappedCriteria
        }));
        setCustomSectionFlags(flags);
        setMode(looksLikeQuestions(mappedCriteria) ? 'questions' : 'criteria');
    };

    // Handler pour le changement de modèle
    const handleTemplateChange = async (e) => {
        const templateId = e.target.value;
        setSelectedTemplateId(templateId);
        if (!templateId) return;

        setIsLoadingTemplate(true);
        try {
            const res = await getEvaluationById(templateId);
            const templateData = res.data.data;
            // On applique les données du template sur le formulaire actuel (en mode copie)
            fillFormFromData(templateData, true);
        } catch (err) {
            console.error("Erreur chargement détails template", err);
        } finally {
            setIsLoadingTemplate(false);
        }
    };

    useEffect(() => {
        if (!evaluation && !evaluationToCopy && subjects.length === 1) {
            setFormData(prev => ({ ...prev, subject_id: subjects[0].id }));
        }
    }, [subjects, evaluation, evaluationToCopy]);

    const existingSections = useMemo(() => Array.from(
        new Set(formData.criteria.map(c => c.section_name).filter(name => name?.trim()))
    ), [formData.criteria]);

    const updateCriterion = useCallback((index, field, value) => {
        setFormData(prev => ({
            ...prev,
            criteria: prev.criteria.map((c, i) =>
                i === index ? { ...c, [field]: value } : c
            )
        }));
    }, []);

    const setCustomFlag = useCallback((tempId, value) => {
        setCustomSectionFlags(prev => ({ ...prev, [tempId]: value }));
    }, []);

    const handleDragEnd = useCallback((event) => {
        const { active, over } = event;
        if (active && over && active.id !== over.id) {
            setFormData(prev => {
                const oldIndex = prev.criteria.findIndex(c => c.tempId === active.id);
                const newIndex = prev.criteria.findIndex(c => c.tempId === over.id);
                return { ...prev, criteria: arrayMove(prev.criteria, oldIndex, newIndex) };
            });
        }
    }, []);

    const addObjective = useCallback(() => {
        const newTempId = Math.random().toString(36).substr(2, 9);
        setFormData(prev => ({
            ...prev,
            criteria: [
                ...prev.criteria,
                { tempId: newTempId, name: '', section_name: 'Général', max_points: 0 }
            ]
        }));
        setCustomSectionFlags(prev => ({ ...prev, [newTempId]: false }));
    }, []);

    const removeCriterion = useCallback((index) => {
        setFormData(prev => {
            const removed = prev.criteria[index];
            return { ...prev, criteria: prev.criteria.filter((_, i) => i !== index) };
        });
    }, []);

    // --- Mode « par questions » ---
    const switchToQuestions = useCallback(() => {
        setFormData(prev => {
            // Le critère vide de départ est remplacé par 5 questions ; sinon on garde
            // les critères existants (et leurs notes) en nommant Q1.. ceux sans nom.
            const onlyBlank = prev.criteria.length === 0 ||
                (prev.criteria.length === 1 && !prev.criteria[0].id && !(prev.criteria[0].name || '').trim());
            const criteria = onlyBlank
                ? Array.from({ length: 5 }, (_, i) => makeQuestion(i + 1, defaultPoints))
                : prev.criteria.map((c, i) => (c.name || '').trim() ? c : { ...c, name: `Q${i + 1}` });
            return { ...prev, criteria };
        });
        setMode('questions');
    }, [defaultPoints]);

    const setQuestionCount = useCallback((raw) => {
        const n = Math.max(0, Math.min(100, parseInt(raw, 10) || 0));
        const cur = formData.criteria;
        if (n === cur.length) return;
        if (n < cur.length) {
            const saved = cur.slice(n).filter(c => c.id).length;
            if (saved > 0 && !window.confirm(
                `Supprimer ${cur.length - n} question(s) déjà enregistrée(s) ? Les points déjà encodés pour ces questions seront perdus.`
            )) return;
            setFormData(prev => ({ ...prev, criteria: prev.criteria.slice(0, n) }));
            return;
        }
        setFormData(prev => ({
            ...prev,
            criteria: [
                ...prev.criteria,
                ...Array.from({ length: n - prev.criteria.length },
                    (_, i) => makeQuestion(prev.criteria.length + i + 1, defaultPoints))
            ]
        }));
    }, [formData.criteria, defaultPoints]);

    const applyPointsToAll = useCallback(() => {
        setFormData(prev => ({
            ...prev,
            criteria: prev.criteria.map(c => ({ ...c, max_points: defaultPoints }))
        }));
    }, [defaultPoints]);

    const handleSave = useCallback(() => {
        onSave({
            ...formData,
            max_score: totalMaxScore, // On ajoute le total calculé ici
            journal_id: currentJournal.id
        });
    }, [formData, totalMaxScore, currentJournal, onSave]);

    const criteriaIds = useMemo(() => formData.criteria.map(c => c.tempId), [formData.criteria]);

    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-container evaluation-modal">
                <div className="modal-header">
                    <h2>{evaluation ? 'Modifier' : 'Créer'} l'évaluation</h2>
                    <button className="close-btn" onClick={onClose}><X size={24} /></button>
                </div>

                <div className="modal-body">
                    {/* SECTION TEMPLATE - Uniquement en création */}
                    {!evaluation && !evaluationToCopy && (
                        <div className="template-selector-zone">
                            <div className="form-group">
                                <label><Copy size={14} /> Utiliser une évaluation existante comme modèle</label>
                                <select
                                    value={selectedTemplateId}
                                    onChange={handleTemplateChange}
                                    className="template-select"
                                >
                                    <option value="">-- Partir de zéro --</option>
                                    {templates.map(t => (
                                        console.log(t),
                                        <option key={t.id} value={t.id}>
                                            [{t.journal_name}] {t.title}
                                        </option>
                                    ))}
                                </select>
                                {isLoadingTemplate && <span className="loader-inline">Chargement des critères...</span>}
                            </div>
                            <hr className="separator" />
                        </div>
                    )}

                    <div className="form-grid">
                        <div className="form-group">
                            <label>Titre</label>
                            <input
                                value={formData.title}
                                onChange={e => setFormData(prev => ({ ...prev, title: e.target.value }))}
                                placeholder="ex: Contrôle n°1"
                            />
                        </div>
                        <div className="form-group">
                            <label>Classe</label>
                            <select
                                value={formData.class_id}
                                onChange={e => setFormData(prev => ({ ...prev, class_id: e.target.value }))}
                            >
                                <option value="">Sélectionner...</option>
                                {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Matière</label>
                            <select
                                value={formData.subject_id}
                                onChange={e => setFormData(prev => ({ ...prev, subject_id: e.target.value }))}
                                required
                            >
                                <option value="">Choisir une matière...</option>
                                {subjects.map(s => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Dossier / Période</label>
                            <input
                                value={formData.folder}
                                onChange={e => setFormData(prev => ({ ...prev, folder: e.target.value }))}
                                placeholder="ex: T1 ou Chapitre 1"
                            />
                        </div>
                        <div className="form-group">
                            <label>Date</label>
                            <input
                                type="date"
                                value={formData.evaluation_date}
                                onChange={e => setFormData(prev => ({ ...prev, evaluation_date: e.target.value }))}
                            />
                        </div>
                    </div>

                    <div className="mode-switch" role="tablist" aria-label="Type de grille">
                        <button
                            type="button"
                            role="tab"
                            aria-selected={mode === 'criteria'}
                            className={mode === 'criteria' ? 'active' : ''}
                            onClick={() => setMode('criteria')}
                        >
                            <ListChecks size={16} /> Par critères
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={mode === 'questions'}
                            className={mode === 'questions' ? 'active' : ''}
                            onClick={() => mode !== 'questions' && switchToQuestions()}
                        >
                            <ListOrdered size={16} /> Par questions (sans critères)
                        </button>
                    </div>

                    {mode === 'questions' ? (
                    <div className="criteria-section-editor questions-editor">
                        <div className="section-header">
                            <h3>Questions</h3>
                            <span className="total-badge">Total : {totalMaxScore} pts</span>
                        </div>

                        <div className="questions-settings">
                            <div className="form-group">
                                <label htmlFor="q-count">Nombre de questions</label>
                                <input
                                    id="q-count"
                                    type="number"
                                    min="0"
                                    max="100"
                                    value={formData.criteria.length}
                                    onChange={e => setQuestionCount(e.target.value)}
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="q-default">Points par défaut</label>
                                <input
                                    id="q-default"
                                    type="number"
                                    step="0.25"
                                    min="0"
                                    value={defaultPoints}
                                    onChange={e => setDefaultPoints(e.target.value)}
                                />
                            </div>
                            <button type="button" className="btn-add-crit" onClick={applyPointsToAll}>
                                Appliquer à toutes
                            </button>
                        </div>

                        <div className="questions-grid">
                            {formData.criteria.map((c, index) => (
                                <label key={c.tempId} className="question-cell">
                                    <span>{c.name || `Q${index + 1}`}</span>
                                    <input
                                        type="number"
                                        step="0.25"
                                        min="0"
                                        value={c.max_points}
                                        onChange={e => updateCriterion(index, 'max_points', e.target.value)}
                                    />
                                </label>
                            ))}
                        </div>
                    </div>
                    ) : (
                    <div className="criteria-section-editor">
                        <div className="section-header">
                            <h3>Structure des critères</h3>
                            <button type="button" className="btn-add-crit" onClick={addObjective}>
                                <Plus size={16} /> Ajouter un critère
                            </button>
                        </div>

                        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                            <SortableContext items={criteriaIds} strategy={verticalListSortingStrategy}>
                                <div className="sortable-list">
                                    {formData.criteria.map((c, index) => (
                                        <SortableCriterion
                                            key={c.tempId}
                                            id={c.tempId}
                                            criterion={c}
                                            index={index}
                                            onUpdate={updateCriterion}
                                            onRemove={removeCriterion}
                                            sections={existingSections}
                                            isCustomSection={customSectionFlags[c.tempId] ?? false}
                                            setCustomSection={setCustomFlag}
                                        />
                                    ))}
                                </div>
                            </SortableContext>
                        </DndContext>
                    </div>
                    )}
                </div>

                <div className="modal-footer">
                    <button className="btn-cancel" onClick={onClose}>Annuler</button>
                    <button className="btn-save" onClick={handleSave}>
                        <Save size={18} /> Enregistrer
                    </button>
                </div>
            </div>
        </div>
    );
};

export default EvaluationModal;