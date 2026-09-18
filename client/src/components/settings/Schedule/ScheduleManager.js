// frontend/src/components/ScheduleManager.js
//
// Grille horaire de l'établissement affiché. Deux écoles peuvent découper la
// journée différemment ; tant qu'une école n'a pas sa propre grille, elle lit
// la grille commune — que l'on peut alors détacher en un clic.
import React, { useState } from 'react';
import { useScheduleHours } from '../../../hooks/useScheduleHours';
import { useSchools } from '../../../hooks/useSchools';
import { useToast } from '../../../hooks/useToast';
import './ScheduleManager.scss';
import { Clock } from "lucide-react";

const ScheduleManager = () => {
    const { currentSchool, hasMultipleSchools } = useSchools();
    const { hours, isOwn, loading, error, addHour, updateHour, removeHour, detachHours } = useScheduleHours();
    const { success, error: showError } = useToast();

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalData, setModalData] = useState({ id: null, libelle: '', isEdit: false });
    const [validationError, setValidationError] = useState('');

    const validateTimeSlot = (timeSlot) => {
        const regex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]-([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
        if (!regex.test(timeSlot)) return "Format invalide. Utilisez HH:MM-HH:MM";
        const [start, end] = timeSlot.split('-');
        const [startH, startM] = start.split(':').map(Number);
        const [endH, endM] = end.split(':').map(Number);
        if ((startH * 60 + startM) >= (endH * 60 + endM)) return "L'heure de fin doit être après le début";
        return null;
    };

    const handleOpenModal = (hour = null) => {
        setModalData(hour
            ? { id: hour.id, libelle: hour.libelle, isEdit: true }
            : { id: null, libelle: '', isEdit: false }
        );
        setValidationError('');
        setIsModalOpen(true);
    };

    const handleSave = async (e) => {
        e.preventDefault();
        const error = validateTimeSlot(modalData.libelle.trim());
        if (error) return setValidationError(error);

        try {
            if (modalData.isEdit) await updateHour(modalData.id, { libelle: modalData.libelle });
            else await addHour({ libelle: modalData.libelle });
            setIsModalOpen(false);
        } catch (err) {
            setValidationError(err.response?.data?.message || err.message);
        }
    };

    const handleRemove = async (hour) => {
        try {
            await removeHour(hour.id);
            success('Créneau supprimé.');
        } catch (err) {
            showError(err.response?.data?.message || 'Suppression impossible.');
        }
    };

    const handleDetach = async () => {
        try {
            await detachHours();
            success(`${currentSchool.name} a maintenant sa propre grille horaire.`);
        } catch (err) {
            showError(err.response?.data?.message || 'Échec du détachement.');
        }
    };

    const getSlotDuration = (libelle) => {
        const [s, e] = libelle.split('-');
        const parse = (t) => { const [h, m] = t.split(':'); return h * 60 + parseInt(m); };
        return parse(e) - parse(s);
    };

    if (loading) return <div className="schedule-manager-container loading"><span>⏳ Chargement...</span></div>;

    // « 8:30 » comme « 08:30 » : on trie sur les minutes, pas sur le texte.
    const startMinutes = (libelle) => {
        const [h, m] = String(libelle || '').split('-')[0].split(':');
        return Number(h) * 60 + Number(m);
    };
    const sortedHours = [...hours].sort((a, b) => startMinutes(a.libelle) - startMinutes(b.libelle));

    return (
        <div className="schedule-manager-container">
            <header className="manager-header">
                <div className="title-wrapper">
                    <div>
                        <h2>
                            <Clock className="icon-lucid"/>
                            Heures de cours
                        </h2>
                        <p>
                            {currentSchool
                                ? <>Créneaux de <strong>{currentSchool.name}</strong></>
                                : "Créneaux de l'établissement"}
                        </p>
                    </div>
                </div>
                <button className="add-glass-btn" onClick={() => handleOpenModal()}>
                    <span>+</span> Nouveau Créneau
                </button>
            </header>

            {/* Tant que l'école lit la grille commune, la modifier toucherait
                tous les établissements : on propose d'abord de la détacher. */}
            {!isOwn && currentSchool && (
                <div className="shared-grid-notice">
                    <p>
                        {hasMultipleSchools
                            ? <><strong>{currentSchool.name}</strong> utilise la grille horaire commune. Détachez-la pour lui donner ses propres créneaux sans toucher à l'autre école.</>
                            : <><strong>{currentSchool.name}</strong> utilise la grille horaire commune.</>}
                    </p>
                    <button type="button" className="detach-btn" onClick={handleDetach}>
                        Créer une grille propre
                    </button>
                </div>
            )}

            {error && <div className="error-text">{error}</div>}

            <div className="schedule-grid">
                {sortedHours.length === 0 ? (
                    <div className="empty-state">Aucun créneau configuré.</div>
                ) : (
                    sortedHours.map((hour, index) => (
                        <div key={hour.id} className="schedule-card">
                            <div className="card-index">#{index + 1}</div>
                            <div className="card-info">
                                <span className="time">{hour.libelle}</span>
                                <span className="duration">{getSlotDuration(hour.libelle)} min</span>
                            </div>
                            <div className="card-actions">
                                <button onClick={() => handleOpenModal(hour)} className="action-btn edit">✏️</button>
                                <button onClick={() => handleRemove(hour)} className="action-btn delete">🗑️</button>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {isModalOpen && (
                <div className="glass-modal-overlay">
                    <div className="glass-modal">
                        <h3>{modalData.isEdit ? 'Modifier' : 'Ajouter'} un créneau</h3>
                        <form onSubmit={handleSave}>
                            <div className="input-group">
                                <label>Heures (HH:MM-HH:MM)</label>
                                <input
                                    autoFocus
                                    placeholder="08:00-09:00"
                                    value={modalData.libelle}
                                    onChange={e => setModalData({...modalData, libelle: e.target.value})}
                                />
                                {validationError && <span className="error-text">{validationError}</span>}
                            </div>
                            <div className="modal-footer">
                                <button type="button" onClick={() => setIsModalOpen(false)}>Annuler</button>
                                <button type="submit" className="confirm-btn">Enregistrer</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ScheduleManager;
