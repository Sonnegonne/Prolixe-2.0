import React, { useState } from 'react';
import NoteService from '../../services/NoteService';
import ConfirmModal from '../ConfirmModal'; // Assurez-vous du chemin vers votre composant
import { Clock, Navigation, Trash2, Pencil, X, Check } from "lucide-react";
import './NoteSection.scss';

// « 2026-09-25 » -> « 25/09/2026 », sans passer par Date : une date sans
// heure est lue en UTC et pouvait reculer d'un jour selon le fuseau.
const toFrenchDate = (value) => {
    const [y, m, d] = String(value || '').split('T')[0].split('-');
    return d ? `${d}/${m}/${y}` : '';
};

const Note = ({ note, onDelete, onUpdate, stateLabel, isPast = false }) => {
    // Formatage de la date pour l'input
    const getFormattedDate = (dateString) => String(dateString || '').split('T')[0];

    const [isEditing, setIsEditing] = useState(false);
    const [editText, setEditText] = useState(note.text);
    const [editDate, setEditDate] = useState(getFormattedDate(note.date));
    const [editTime, setEditTime] = useState((note.time || '').slice(0, 5));
    const [editLocation, setEditLocation] = useState(note.location || '');
    const [editState, setEditState] = useState(note.state || 'autre');

    // État pour la modale de confirmation
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);

    // --- Actions ---
    const handleSave = async () => {
        try {
            await NoteService.updateNote(note.id, {
                text: editText,
                date: editDate,
                time: editTime,
                location: editLocation,
                state: editState,
            });
            onUpdate(); // Rafraîchit la liste parente
            setIsEditing(false);
        } catch (error) {
            console.error("Erreur mise à jour note:", error);
        }
    };

    const performDelete = async () => {
        try {
            await NoteService.deleteNote(note.id);
            onDelete(); // Rafraîchit la liste parente
        } catch (error) {
            console.error("Erreur suppression note:", error);
        } finally {
            setIsConfirmOpen(false);
        }
    };

    // --- Rendus ---
    // Appelés comme des fonctions, pas comme <NoteEditForm /> : un composant
    // redéfini à chaque rendu est démonté à chaque frappe, et le champ en
    // cours de saisie perdait le focus après chaque caractère.
    const renderDisplay = () => {
        const stateSlug = note.state?.toLowerCase().replace(/\s+/g, '-') || 'autre';
        const isAppointment = Boolean(note.date && note.time);
        return (
            <div className={`note-item state-${stateSlug}${isAppointment ? ' is-appointment' : ''}${isPast ? ' is-past' : ''}`} onDoubleClick={() => setIsEditing(true)}>
                <div className="note-content-wrapper">
                    <div className="note-header">
                        {isAppointment && <strong className="note-category note-rdv">Rendez-vous</strong>}
                        {note.state && note.state !== 'autre' && (
                            <strong className="note-category">{stateLabel || note.state}</strong>
                        )}
                        {note.date && <span className="note-date">🗓️ {toFrenchDate(note.date)}</span>}
                        {note.time && <span className="note-time"><Clock size={13} /> {note.time.slice(0, 5)}</span>}
                        {note.location && <span className="note-location"><Navigation size={13} /> {note.location}</span>}
                    </div>
                    {note.text && <p className="note-text">{note.text}</p>}
                </div>
                <div className="note-actions-buttons">
                    <button onClick={() => setIsEditing(true)} className="edit-note-btn" title="Modifier" aria-label="Modifier">
                        <Pencil size={16} />
                    </button>
                    <button onClick={() => setIsConfirmOpen(true)} className="delete-note-btn" title="Supprimer" aria-label="Supprimer">
                        <Trash2 size={16} />
                    </button>
                </div>
            </div>
        );
    };

    const renderEditForm = () => (
        <div className="note-item-edit-form">
            <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                placeholder="Votre note..."
                rows="3"
            />
            <div className="note-controls form-group">
                <select
                    className={`state-select state-${editState.replace(/\s+/g, '-')}`}
                    value={editState}
                    onChange={(e) => setEditState(e.target.value)}
                >
                    <option value="autre">Autre</option>
                    <option value="todo">À faire (TODO)</option>
                    <option value="cap">CAP</option>
                    <option value="conseil-de-classe">Conseil de classe</option>
                    <option value="réunions-de-parents">Réunions de parents</option>
                </select>
                <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
                <input type="time" value={editTime} onChange={(e) => setEditTime(e.target.value)} />
                <input type="text" value={editLocation} onChange={(e) => setEditLocation(e.target.value)} placeholder="Lieu" />
            </div>
            <div className="note-actions form-group">
                <button onClick={handleSave} className="btn-actions save-btn">
                    <Check size={16} /> Enregistrer
                </button>
                <button onClick={() => setIsEditing(false)} className="btn-actions cancel-btn">
                    <X size={16} /> Annuler
                </button>
            </div>
        </div>
    );

    return (
        <>
                {isEditing ? renderEditForm() : renderDisplay()}
                    <ConfirmModal
                        isOpen={isConfirmOpen}
                        onClose={() => setIsConfirmOpen(false)}
                        onConfirm={performDelete}
                        title="Supprimer la note" aria-label="Supprimer la note"
                        message="Voulez-vous vraiment supprimer cette note ?"
                        confirmText="Supprimer"
                        type="danger"
                    />
        </>
    );
};

export default Note;