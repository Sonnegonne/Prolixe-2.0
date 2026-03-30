import React, { useState, useEffect, useCallback } from 'react';
import ScheduleService from '../../../services/ScheduleService';
import { useToast } from '../../../hooks/useToast';
import { useScheduleHours } from "../../../hooks/useScheduleHours";
import { useJournal } from '../../../hooks/useJournal';
import { useSubjects } from '../../../hooks/useSubjects';
import { useClasses } from '../../../hooks/useClasses';
import ConfirmModal from '../../ConfirmModal';
import {
    Plus, Save, Calendar, MapPin, BookOpen,
    Users, Loader2, Copy, Trash2, Clock, X, Edit2, AlertTriangle
} from 'lucide-react';
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

    // États de données
    const [sets, setSets] = useState([]);
    const [selectedSet, setSelectedSet] = useState('');
    const [grid, setGrid] = useState({});

    // États pour Création / Duplication / Edition
    const [newSetName, setNewSetName] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    const [modalType, setModalType] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [loadingSets, setLoadingSets] = useState(true);

    const [collisionData, setCollisionData] = useState(null);

    const { hours, loading: loadingHours } = useScheduleHours();
    const { subjects, loadSubjects } = useSubjects();
    const { getClassesForSchedule, loading: loadingCls } = useClasses(journalId);

    const [confirmModal, setConfirmModal] = useState({
        isOpen: false, title: '', message: '', onConfirm: null
    });

    /**
     * CORRECTION : Formate n'importe quel type de date en YYYY-MM-DD
     * Indispensable pour les <input type="date" />
     */
    const formatDateForInput = (dateValue) => {
        if (!dateValue) return '';
        const date = new Date(dateValue);
        if (isNaN(date.getTime())) return '';

        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');

        return `${year}-${month}-${day}`;
    };

    // --- LOGIQUE DE COLLISION ---
    const checkCollision = (newStart, newEnd, currentSets, excludeId = null) => {
        const start = new Date(newStart);
        const end = new Date(newEnd);
        return currentSets.find(s => {
            if (excludeId && Number(s.id) === Number(excludeId)) return false;
            const sStart = new Date(s.start_time);
            const sEnd = new Date(s.end_time);
            return start <= sEnd && end >= sStart;
        });
    };

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
        } catch (err) {
            showError('Erreur lors de la récupération des données');
        }
    }, [showError]);

    const loadInitialData = useCallback(async () => {
        if (!journalId) return;
        try {
            setLoadingSets(true);
            const [resSets] = await Promise.all([
                ScheduleService.getScheduleSets(journalId),
                loadSubjects(journalId)
            ]);
            const fetchedSets = resSets.data || [];
            setSets(fetchedSets);
            if (fetchedSets.length > 0) {
                handleSelectSet(fetchedSets[fetchedSets.length - 1].id);
            }
        } catch (err) {
            showError('Erreur de chargement');
        } finally {
            setLoadingSets(false);
        }
    }, [journalId, loadSubjects, showError, handleSelectSet]);

    useEffect(() => { loadInitialData(); }, [loadInitialData]);

    // --- ACTIONS API ---
    const executeCreate = async () => {
        try {
            setIsSubmitting(true);
            const res = await ScheduleService.createScheduleSet(newSetName, journalId, startDate, endDate);
            const newId = res.id || res.data?.id;
            const newSet = { id: newId, name: newSetName, start_time: startDate, end_time: endDate };
            setSets(prev => [...prev, newSet]);
            handleSelectSet(newId);
            setModalType(null);
            setNewSetName('');
            success('Modèle créé avec succès');
        } catch (err) { showError('Erreur lors de la création'); }
        finally { setIsSubmitting(false); }
    };

    const executeUpdate = async () => {
        try {
            setIsSubmitting(true);
            await ScheduleService.updateScheduleSet(selectedSet, { name: newSetName, startDate, endDate });
            setSets(prev => prev.map(s => Number(s.id) === Number(selectedSet)
                ? { ...s, name: newSetName, start_time: startDate, end_time: endDate } : s
            ));
            setModalType(null);
            success('Modèle mis à jour');
        } catch (err) { showError('Erreur mise à jour'); }
        finally { setIsSubmitting(false); }
    };

    const executeDuplicate = async () => {
        try {
            setIsSubmitting(true);
            const res = await ScheduleService.duplicateScheduleSet(selectedSet, newSetName, startDate, endDate);
            const newSet = { ...(res.data || res), name: newSetName, start_time: startDate, end_time: endDate };
            setSets(prev => [...prev, newSet]);
            handleSelectSet(newSet.id);
            setModalType(null);
            success('Horaire dupliqué');
        } catch (err) { showError('Erreur duplication'); }
        finally { setIsSubmitting(false); }
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (new Date(endDate) < new Date(startDate)) {
            showError("La date de fin ne peut pas être avant la date de début.");
            return;
        }
        const excludeId = modalType === 'edit' ? selectedSet : null;
        const collidingSet = checkCollision(startDate, endDate, sets, excludeId);

        if (collidingSet) {
            setCollisionData({ collidingSet });
        } else {
            processAction();
        }
    };

    const processAction = () => {
        if (modalType === 'create') executeCreate();
        if (modalType === 'edit') executeUpdate();
        if (modalType === 'duplicate') executeDuplicate();
    };

    const resolveCollision = async () => {
        try {
            setIsSubmitting(true);
            const { collidingSet } = collisionData;
            const newEndDate = new Date(startDate);
            newEndDate.setDate(newEndDate.getDate() - 1);
            const formattedDate = formatDateForInput(newEndDate);

            await ScheduleService.updateScheduleSet(collidingSet.id, {
                ...collidingSet,
                startDate: formatDateForInput(collidingSet.start_time),
                endDate: formattedDate
            });

            setSets(prev => prev.map(s => s.id === collidingSet.id ? { ...s, end_time: formattedDate } : s));
            setCollisionData(null);
            processAction();
        } catch (err) { showError("Erreur lors de la résolution"); setIsSubmitting(false); }
    };

    // --- HANDLERS D'OUVERTURE ---
    const openCreate = (e) => {
        e.preventDefault();
        if (!newSetName.trim()) return;
        const current = sets.find(s => Number(s.id) === Number(selectedSet));
        setStartDate(formatDateForInput(current?.start_time) || '');
        setEndDate(formatDateForInput(current?.end_time) || '');
        setModalType('create');
    };

    const openEdit = () => {
        const current = sets.find(s => Number(s.id) === Number(selectedSet));
        if (!current) return;
        setNewSetName(current.name);
        setStartDate(formatDateForInput(current.start_time));
        setEndDate(formatDateForInput(current.end_time));
        setModalType('edit');
    };

    const openDuplicate = () => {
        const current = sets.find(s => Number(s.id) === Number(selectedSet));
        if (!current) return;
        setNewSetName(`${current.name} - Copie`);
        setStartDate(formatDateForInput(current.start_time));
        setEndDate(formatDateForInput(current.end_time));
        setModalType('duplicate');
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
        } catch (err) { showError('Erreur de sauvegarde'); }
        finally { setIsSubmitting(false); }
    };

    const handleDelete = () => {
        const currentSet = sets.find(s => Number(s.id) === Number(selectedSet));
        setConfirmModal({
            isOpen: true,
            title: "Suppression",
            message: `Supprimer "${currentSet?.name}" ?`,
            onConfirm: async () => {
                await ScheduleService.deleteScheduleSet(selectedSet);
                const updated = sets.filter(s => Number(s.id) !== Number(selectedSet));
                setSets(updated);
                if (updated.length > 0) handleSelectSet(updated[updated.length - 1].id);
                else { setSelectedSet(''); setGrid({}); }
            }
        });
    };

    const updateCell = (dayId, hourId, field, value) => {
        const key = `${dayId}-${hourId}`;
        setGrid(prev => ({
            ...prev,
            [key]: { ...(prev[key] || { subject_id: '', class_id: '', room: '' }), [field]: value }
        }));
    };

    const clearCell = (dayId, hourId) => {
        const key = `${dayId}-${hourId}`;
        setGrid(prev => {
            const newGrid = { ...prev };
            delete newGrid[key];
            return newGrid;
        });
    };

    const getGradatedColor = (subjectId, classId) => {
        const subject = subjects.find(s => Number(s.id) === Number(subjectId));
        if (!subject || !subject.color_code) return 'white';
        const cls = getClassesForSchedule().find(c => Number(c.id) === Number(classId));
        const level = cls ? parseInt(cls.level) || 1 : 1;
        return `color-mix(in srgb, ${subject.color_code}, black ${level * 10}%)`;
    };

    if (loadingHours || loadingSets || loadingCls) {
        return <div className="glass-loader"><Loader2 className="animate-spin" size={40} /></div>;
    }

    const currentSetData = sets.find(s => Number(s.id) === Number(selectedSet));

    return (
        <div className="schedule-creator-glass">
            <header className="glass-header">
                <div className="header-main-row">
                    <div className="section-title">
                        <Calendar size={24} className="accent-icon" />
                        <h2>Emploi du temps</h2>
                    </div>

                    <div className="header-actions">
                        <form onSubmit={openCreate} className="quick-create">
                            <input
                                type="text"
                                placeholder="Nom du nouveau modèle..."
                                value={newSetName}
                                onChange={(e) => setNewSetName(e.target.value)}
                                className="glass-input"
                            />
                            <button type="submit" className="glass-btn primary circle" title="Ajouter">
                                <Plus size={20} />
                            </button>
                        </form>
                        <div className="v-divider" />
                        <select value={selectedSet} onChange={(e) => handleSelectSet(e.target.value)} className="glass-select">
                            <option value="">Sélectionner un horaire...</option>
                            {sets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                    </div>
                </div>

                {selectedSet && (
                    <div className="header-info-row">
                        <div className="validity-badge">
                            <Clock size={14} />
                            <span>Du {new Date(currentSetData?.start_time).toLocaleDateString()} au {new Date(currentSetData?.end_time).toLocaleDateString()}</span>
                            <button className="edit-meta-btn" onClick={openEdit} title="Modifier les dates/nom">
                                <Edit2 size={14} />
                            </button>
                        </div>
                        <div className="button-group">
                            <button className="glass-btn success" onClick={handleSave} disabled={isSubmitting}>
                                <Save size={18} /> <span>Sauvegarder</span>
                            </button>
                            <button className="glass-btn secondary" onClick={openDuplicate} title="Dupliquer">
                                <Copy size={18} />
                            </button>
                            <button className="glass-btn danger-text" onClick={handleDelete} title="Supprimer">
                                <Trash2 size={18} />
                            </button>
                        </div>
                    </div>
                )}
            </header>

            {selectedSet ? (
                <div className="table-container">
                    <table className="glass-table">
                        <thead>
                        <tr>
                            <th>Heures</th>
                            {DAYS.map(d => <th key={d.id}>{d.label}</th>)}
                        </tr>
                        </thead>
                        <tbody>
                        {hours.map(h => (
                            <tr key={h.id}>
                                <td className="time-label">
                                    <strong>{h.libelle}</strong>
                                    <small>{h.start_time?.substring(0, 5)}</small>
                                </td>
                                {DAYS.map(d => {
                                    const cell = grid[`${d.id}-${h.id}`] || {};
                                    const cellColor = getGradatedColor(cell.subject_id, cell.class_id);
                                    const hasContent = cell.subject_id || cell.class_id || cell.room;
                                    return (
                                        <td key={`${d.id}-${h.id}`} className="grid-cell" style={{ '--subject-color': cellColor }}>
                                            <div className="cell-content">
                                                {hasContent && (
                                                    <button className="btn-clear-slot" onClick={() => clearCell(d.id, h.id)} title="Supprimer ce cours">
                                                        <X size={12} />
                                                    </button>
                                                )}
                                                <div className="input-wrapper main-sub">
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
                                                    <input type="text" placeholder="Salle" value={cell.room || ''} onChange={(e) => updateCell(d.id, h.id, 'room', e.target.value)} />
                                                </div>
                                            </div>
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div className="empty-state">
                    <div className="icon-circle"><Calendar size={40} /></div>
                    <h3>Aucun horaire sélectionné</h3>
                    <p>Utilisez la barre en haut pour créer un nouveau modèle.</p>
                </div>
            )}

            {modalType && (
                <div className="modal-overlay">
                    <div className="glass-modal">
                        <div className="modal-header">
                            <h3>
                                {modalType === 'create' && "Nouveau modèle"}
                                {modalType === 'duplicate' && "Dupliquer le modèle"}
                                {modalType === 'edit' && "Modifier le modèle"}
                            </h3>
                            <button className="close-btn" onClick={() => setModalType(null)}><X size={20} /></button>
                        </div>
                        <form onSubmit={handleSubmit}>
                            <div className="form-group mb-4">
                                <label>Nom du modèle</label>
                                <input type="text" value={newSetName} onChange={(e) => setNewSetName(e.target.value)} required className="glass-input" />
                            </div>
                            <div className="form-grid">
                                <div className="form-group">
                                    <label>Date de début</label>
                                    <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required className="glass-input" />
                                </div>
                                <div className="form-group">
                                    <label>Date de fin</label>
                                    <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required className="glass-input" />
                                </div>
                            </div>
                            <div className="modal-footer mt-6">
                                <button type="button" className="glass-btn" onClick={() => setModalType(null)}>Annuler</button>
                                <button type="submit" className="glass-btn primary" disabled={isSubmitting}>
                                    {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : "Confirmer"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {collisionData && (
                <div className="modal-overlay z-50">
                    <div className="glass-modal alert-modal">
                        <div className="modal-header">
                            <div className="alert-title-group">
                                <AlertTriangle className="text-warning" size={28} />
                                <h3>Collision de périodes</h3>
                            </div>
                        </div>
                        <div className="modal-body py-4">
                            <p>Ce modèle chevauche l'horaire <strong>"{collisionData.collidingSet.name}"</strong>
                                ({new Date(collisionData.collidingSet.start_time).toLocaleDateString()} au {new Date(collisionData.collidingSet.end_time).toLocaleDateString()}).</p>
                            <p className="mt-3 font-medium">Que souhaitez-vous faire ?</p>
                        </div>
                        <div className="modal-footer flex-col gap-2">
                            <button className="glass-btn warning-outline w-full justify-start text-left" onClick={resolveCollision}>
                                <strong>1. Ajuster l'ancien :</strong> Terminer "{collisionData.collidingSet.name}" le {new Date(new Date(startDate).setDate(new Date(startDate).getDate() - 1)).toLocaleDateString()}.
                            </button>
                            <button className="glass-btn secondary-outline w-full justify-start text-left" onClick={() => { setCollisionData(null); processAction(); }}>
                                <strong>2. Coexister :</strong> Créer quand même et laisser les deux actifs sur cette période.
                            </button>
                            <button className="glass-btn danger-text w-full" onClick={() => setCollisionData(null)}>
                                3. Annuler
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <ConfirmModal
                isOpen={confirmModal.isOpen}
                title={confirmModal.title}
                message={confirmModal.message}
                onClose={() => setConfirmModal(p => ({ ...p, isOpen: false }))}
                onConfirm={async () => {
                    await confirmModal.onConfirm();
                    setConfirmModal(p => ({ ...p, isOpen: false }));
                }}
            />
        </div>
    );
};

export default ScheduleCreator;