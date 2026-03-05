import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { X, Plus, Save } from 'lucide-react';
import { useJournal } from '../../hooks/useJournal';
import ClassService from '../../services/ClassService';
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

const EvaluationModal = ({ isOpen, onClose, onSave, evaluation, evaluationToCopy }) => {
    const { currentJournal } = useJournal();
    const [classes, setClasses] = useState([]);
    const { subjects, loadSubjects } = useSubjects();

    const [formData, setFormData] = useState({
        title: '',
        class_id: '',
        subject_id: '',
        evaluation_date: new Date().toISOString().split('T')[0],
        max_score: 20,
        folder: '',
        criteria: []
    });

    const [customSectionFlags, setCustomSectionFlags] = useState({});

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    useEffect(() => {
        if (!isOpen || !currentJournal?.id) return;

        ClassService.getClasses(currentJournal.id)
            .then(res => setClasses(res.data.data))
            .catch(err => console.error("Erreur chargement classes", err));

        loadSubjects(currentJournal.id);

        if (evaluation) {
            const mappedCriteria = (evaluation.criteria || []).map(c => ({
                ...c,
                name: c.name || c.label || '',
                max_points: c.max_points ?? c.max_score ?? 0,
                section_name: c.section_name || 'Général',
                tempId: Math.random().toString(36).substr(2, 9)
            }));
            const flags = {};
            mappedCriteria.forEach(c => { flags[c.tempId] = false; });
            setFormData({
                ...evaluation,
                subject_id: evaluation.subject_id || '',
                evaluation_date: evaluation.evaluation_date
                    ? evaluation.evaluation_date.split('T')[0]
                    : new Date().toISOString().split('T')[0],
                criteria: mappedCriteria
            });
            setCustomSectionFlags(flags);

        } else if (evaluationToCopy) {
            const mappedCriteria = evaluationToCopy.criteria.map(c => ({
                ...c,
                id: null,
                tempId: Math.random().toString(36).substr(2, 9)
            }));
            const flags = {};
            mappedCriteria.forEach(c => { flags[c.tempId] = false; });
            setFormData({
                ...evaluationToCopy,
                id: null,
                subject_id: evaluationToCopy.subject_id || '',
                title: `${evaluationToCopy.title} (Copie)`,
                evaluation_date: new Date().toISOString().split('T')[0],
                criteria: mappedCriteria
            });
            setCustomSectionFlags(flags);

        } else {
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
            setCustomSectionFlags({ [initTempId]: true });
        }
    }, [isOpen, evaluation, evaluationToCopy, currentJournal]);

    useEffect(() => {
        if (!evaluation && !evaluationToCopy && subjects.length === 1) {
            setFormData(prev => ({ ...prev, subject_id: subjects[0].id }));
        }
    }, [subjects, evaluation, evaluationToCopy]);

    // Mémoïsé : ne change que quand les section_name changent réellement
    const existingSections = useMemo(() => Array.from(
        new Set(formData.criteria.map(c => c.section_name).filter(name => name?.trim()))
    ), [formData.criteria.map(c => c.section_name).join('|')]);

    // Mémoïsé : ne change jamais de référence
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
        setCustomSectionFlags(prev => ({ ...prev, [newTempId]: true }));
    }, []);

    const removeCriterion = useCallback((index) => {
        setFormData(prev => {
            const removed = prev.criteria[index];
            setCustomSectionFlags(flags => {
                const next = { ...flags };
                delete next[removed.tempId];
                return next;
            });
            return { ...prev, criteria: prev.criteria.filter((_, i) => i !== index) };
        });
    }, []);

    const handleSave = useCallback(() => {
        onSave({ ...formData, journal_id: currentJournal.id });
    }, [formData, currentJournal, onSave]);

    // Mémoïsé : évite de recréer le tableau d'IDs à chaque render
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

                    <div className="criteria-section-editor">
                        <div className="section-header">
                            <h3>Structure des critères</h3>
                            <button type="button" className="btn-add-crit" onClick={addObjective}>
                                <Plus size={16} /> Ajouter un critère
                            </button>
                        </div>

                        <DndContext
                            sensors={sensors}
                            collisionDetection={closestCenter}
                            onDragEnd={handleDragEnd}
                        >
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
                                            isCustomSection={customSectionFlags[c.tempId] ?? true}
                                            setCustomSection={setCustomFlag}
                                        />
                                    ))}
                                </div>
                            </SortableContext>
                        </DndContext>
                    </div>
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