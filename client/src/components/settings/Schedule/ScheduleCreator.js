import React, { useState, useEffect, useCallback } from 'react';
import ScheduleService from '../../../services/ScheduleService';
import { useToast } from '../../../hooks/useToast';
import { useScheduleHours } from "../../../hooks/useScheduleHours";
import { useJournal } from '../../../hooks/useJournal';
import { useSubjects } from '../../../hooks/useSubjects';
import { useClasses } from '../../../hooks/useClasses';
import ConfirmModal from '../../ConfirmModal';
import { Plus, Save, Calendar, MapPin, BookOpen, Users, Loader2, Copy, Trash2 } from 'lucide-react';
import './ScheduleCreator.scss';

const DAYS = [
    { id: 1, label: 'Lundi' }, { id: 2, label: 'Mardi' },
    { id: 3, label: 'Mercredi' }, { id: 4, label: 'Jeudi' },
    { id: 5, label: 'Vendredi' }
];

const ScheduleCreator = () => {
    const { currentJournal } = useJournal();
    const journalId = currentJournal?.id;
    const { success, error: showError } = useToast();

    const [isDuplicateModalOpen, setIsDuplicateModalOpen] = useState(false);
    const [duplicateName, setDuplicateName] = useState('');
    const [confirmModal, setConfirmModal] = useState({
        isOpen: false,
        title: '',
        message: '',
        onConfirm: null
    });

    const { hours, loading: loadingHours } = useScheduleHours();
    const { subjects, loadSubjects, loading: loadingSubs } = useSubjects();
    const { getClassesForSchedule, loading: loadingCls } = useClasses(journalId);

    const [sets, setSets] = useState([]);
    const [newSetName, setNewSetName] = useState('');
    const [selectedSet, setSelectedSet] = useState('');
    const [grid, setGrid] = useState({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [loadingSets, setLoadingSets] = useState(true);

    // Fonction pour charger les données d'un set spécifique
    const handleSelectSet = useCallback(async (setId) => {
        setSelectedSet(setId);
        if (!setId) { setGrid({}); return; }
        try {
            const res = await ScheduleService.getScheduleById(setId);
            const formattedGrid = {};
            (res.data || []).forEach(slot => {
                formattedGrid[`${slot.day_of_week}-${slot.time_slot_id}`] = {
                    subject_id: slot.subject_id || '',
                    class_id: slot.class_id || '',
                    room: slot.room || ''
                };
            });
            setGrid(formattedGrid);
        } catch (err) { showError('Erreur récupération'); }
    }, [showError]);

    const loadInitialData = useCallback(async () => {
        if (!journalId) return;
        try {
            setLoadingSets(true);
            const [resSets] = await Promise.all([
                ScheduleService.getScheduleSets(),
                loadSubjects(journalId)
            ]);

            const fetchedSets = resSets.data || [];
            setSets(fetchedSets);

            // Sélection par défaut du dernier de la liste
            if (fetchedSets.length > 0) {
                const lastSet = fetchedSets[fetchedSets.length - 1];
                handleSelectSet(lastSet.id);
            }
        } catch (err) {
            showError('Erreur de chargement');
        } finally {
            setLoadingSets(false);
        }
    }, [journalId, loadSubjects, showError, handleSelectSet]);

    useEffect(() => { loadInitialData(); }, [loadInitialData]);

    const showConfirm = (title, message, onConfirm) => {
        setConfirmModal({ isOpen: true, title, message, onConfirm });
    };

    const closeConfirmModal = () => setConfirmModal(prev => ({ ...prev, isOpen: false }));

    const handleDelete = () => {
        const currentSet = sets.find(s => s.id == selectedSet);
        showConfirm(
            "Supprimer l'emploi du temps",
            `Êtes-vous sûr de vouloir supprimer définitivement "${currentSet?.name}" ?`,
            async () => {
                await ScheduleService.deleteScheduleSet(selectedSet);
                const updatedSets = sets.filter(s => s.id != selectedSet);
                setSets(updatedSets);

                // Après suppression, on sélectionne le nouveau dernier ou on vide
                if (updatedSets.length > 0) {
                    handleSelectSet(updatedSets[updatedSets.length - 1].id);
                } else {
                    setSelectedSet('');
                    setGrid({});
                }
            }
        );
    };

    const handleOpenDuplicateModal = () => {
        const currentSet = sets.find(s => s.id == selectedSet);
        setDuplicateName(`${currentSet?.name || ''} - Copie`);
        setIsDuplicateModalOpen(true);
    };

    const handleDuplicateSubmit = async (e) => {
        e.preventDefault();
        if (!duplicateName.trim()) return;
        try {
            setIsSubmitting(true);
            const res = await ScheduleService.duplicateScheduleSet(selectedSet, duplicateName);
            const newId = res.id;

            setSets(prev => [...prev, { id: newId, name: duplicateName }]);
            success('Horaire dupliqué avec succès !');
            handleSelectSet(newId); // Sélectionne automatiquement le nouveau (qui est le dernier)
            setIsDuplicateModalOpen(false);
        } catch (err) {
            showError('Erreur lors de la duplication.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const getGradatedColor = (subjectId, classId) => {
        const subject = subjects.find(s => s.id == subjectId);
        if (!subject || !subject.color_code) return 'white';
        const cls = getClassesForSchedule().find(c => c.id == classId);
        const level = cls ? parseInt(cls.level) || 1 : 1;
        return `color-mix(in srgb, ${subject.color_code}, black ${level * 10}%)`;
    };

    const updateCell = (dayId, hourId, field, value) => {
        const key = `${dayId}-${hourId}`;
        setGrid(prev => ({
            ...prev,
            [key]: {
                ...(prev[key] || { subject_id: '', class_id: '', room: '' }),
                [field]: value
            }
        }));
    };

    const handleSave = async () => {
        if (!selectedSet) return;
        try {
            setIsSubmitting(true);
            const slots = Object.entries(grid)
                .map(([key, data]) => {
                    const [day, hourId] = key.split('-');
                    return {
                        day_of_week: parseInt(day),
                        time_slot_id: parseInt(hourId),
                        subject_id: data.subject_id ? parseInt(data.subject_id) : null,
                        class_id: data.class_id ? parseInt(data.class_id) : null,
                        room: data.room?.trim() || ''
                    };
                })
                .filter(slot => slot.subject_id || slot.class_id || slot.room);
            await ScheduleService.saveSlots(selectedSet, slots);
            success('Enregistré');
        } catch (err) { showError('Erreur sauvegarde'); }
        finally { setIsSubmitting(false); }
    };

    if (loadingHours || loadingSets || loadingSubs || loadingCls) {
        return <div className="glass-loader"><Loader2 className="animate-spin" /></div>;
    }

    return (
        <div className="schedule-creator-glass">
            <header className="glass-header">
                <div className="section-title">
                    <Calendar size={22} className="accent-icon" />
                    <h2>Gestion de l'Emploi du Temps</h2>
                </div>
                <div className="actions-bar">
                    <form onSubmit={(e) => {
                        e.preventDefault();
                        if (newSetName.trim()) {
                            ScheduleService.createScheduleSet(newSetName, journalId)
                                .then(res => {
                                    const newId = res.id || res.data?.id;
                                    setSets(prev => [...prev, { id: newId, name: newSetName }]);
                                    handleSelectSet(newId);
                                    setNewSetName('');
                                    success('Modèle créé');
                                });
                        }
                    }} className="glass-form">
                        <input
                            type="text"
                            placeholder="Nouveau modèle..."
                            value={newSetName}
                            onChange={(e) => setNewSetName(e.target.value)}
                            className="glass-input"
                        />
                        <button type="submit" disabled={!newSetName.trim()} className="glass-btn primary"><Plus size={18}/></button>
                    </form>
                    <select value={selectedSet} onChange={(e) => handleSelectSet(e.target.value)} className="glass-select">
                        <option value="">Sélectionner un horaire</option>
                        {sets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    {selectedSet && (
                        <div className="button-group" style={{ display: 'flex', gap: '8px' }}>
                            <button className="glass-btn success" onClick={handleSave} disabled={isSubmitting}>
                                <Save size={18} /> <span>Sauvegarder</span>
                            </button>
                            <button className="glass-btn primary" onClick={handleOpenDuplicateModal} disabled={isSubmitting}>
                                <Copy size={18} /> <span>Dupliquer</span>
                            </button>
                            <button className="glass-btn danger" onClick={handleDelete} disabled={isSubmitting} style={{ backgroundColor: 'rgba(220, 38, 38, 0.2)', color: '#ef4444' }}>
                                <Trash2 size={18} />
                            </button>
                        </div>
                    )}
                </div>
            </header>

            {selectedSet ? (
                <div className="table-container">
                    <table className="glass-table">
                        <thead>
                        <tr>
                            <th>Heures</th>
                            {
                                DAYS.map(d => <th key={d.id}>{d.label}
                                </th>)}
                        </tr>
                        </thead>
                        <tbody>
                        {hours.map(h =>
                            <tr key={h.id}>
                                <td className="time-label">
                                    <strong>{h.libelle}</strong>
                                    <small>{h.start_time?.substring(0,5)}</small>
                                </td>
                                {DAYS.map(d => {

                                    const cell = grid[`${d.id}-${h.id}`] || {};
                                    const cellColor = getGradatedColor(cell.subject_id, cell.class_id);
                                    if((d.id === 3 && h.id < 5) || (d.id !== 3)){
                                        return (
                                            <td key={`${d.id}-${h.id}`} className="grid-cell grid-cell-hover" style={{ '--subject-color': cellColor }}>
                                                <div className="input-group">
                                                    <div className="input-wrapper main-select">
                                                        <BookOpen size={12} className="icon" />
                                                        <select value={cell.subject_id || ''} onChange={(e) => updateCell(d.id, h.id, 'subject_id', e.target.value)}>
                                                            <option value="">Matière</option>
                                                            {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                                        </select>
                                                    </div>
                                                    <div className="input-wrapper">
                                                        <Users size={12} className="icon" />
                                                        <select value={cell.class_id || ''} onChange={(e) => updateCell(d.id, h.id, 'class_id', e.target.value)}>
                                                            <option value="">Classe</option>
                                                            {getClassesForSchedule().map(c => <option key={c.id} value={c.id}>{c.shortName}</option>)}
                                                        </select>
                                                    </div>
                                                    <div className="input-wrapper">
                                                        <MapPin size={12} className="icon" />
                                                        <input type="text" placeholder="Local" value={cell.room || ''} onChange={(e) => updateCell(d.id, h.id, 'room', e.target.value)} />
                                                    </div>
                                                </div>
                                            </td>
                                        );
                                    }else{
                                        return (<td className="grid-cell"></td>)
                                    }
                                })}
                            </tr>
                        )}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div className="empty-state"><Calendar size={48} /><p>Sélectionnez un modèle pour commencer.</p></div>
            )}

            {/* Modale Duplication */}
            {isDuplicateModalOpen && (
                <div className="modal-overlay">
                    <div className="modal">
                        <div className="modal-header">
                            <h3>Dupliquer l'emploi du temps</h3>
                            <button className="modal-close" onClick={() => setIsDuplicateModalOpen(false)}>✕</button>
                        </div>
                        <form onSubmit={handleDuplicateSubmit} className="class-form">
                            <div className="form-group">
                                <label htmlFor="dupName">Nom du nouveau modèle</label>
                                <input
                                    id="dupName"
                                    type="text"
                                    value={duplicateName}
                                    onChange={(e) => setDuplicateName(e.target.value)}
                                    required
                                    autoFocus
                                    placeholder="Ex: Horaire Semaine B"
                                />
                            </div>
                            <div className="form-actions">
                                <button type="button" className="btn-secondary" onClick={() => setIsDuplicateModalOpen(false)}>Annuler</button>
                                <button type="submit" className="btn-primary" disabled={isSubmitting || !duplicateName.trim()}>
                                    {isSubmitting ? '...' : 'Dupliquer'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Modale Confirmation */}
            <ConfirmModal
                isOpen={confirmModal.isOpen}
                title={confirmModal.title}
                message={confirmModal.message}
                onClose={closeConfirmModal}
                onConfirm={async () => {
                    try {
                        await confirmModal.onConfirm();
                        success('Action effectuée avec succès.');
                    } catch (err) {
                        showError(err.message || 'Une erreur est survenue.');
                    } finally {
                        closeConfirmModal();
                    }
                }}
            />
        </div>
    );
};

export default ScheduleCreator;