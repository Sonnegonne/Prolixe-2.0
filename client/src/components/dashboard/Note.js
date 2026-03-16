import React, { useState } from 'react';
import NoteService from '../../services/NoteService';
import ConfirmModal from '../ConfirmModal'; // Assurez-vous du chemin vers votre composant
import { Clock, Navigation, Trash2, Pencil, X, Check } from "lucide-react";
import './NoteSection.scss';

const Note = ({ note, onDelete, onUpdate, stateLabel }) => {
    // Formatage de la date pour l'input
    const getFormattedDate = (dateString) => {
        if (!dateString) return '';
        try {
            return new Date(dateString).toISOString().split('T')[0];
        } catch { return ''; }
    };

    const [isEditing, setIsEditing] = useState(false);
    const [editText, setEditText] = useState(note.text);
    const [editDate, setEditDate] = useState(getFormattedDate(note.date));
    const [editTime, setEditTime] = useState(note.time || '');
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

    // --- Sous-composants de rendu ---
    const NoteDisplay = () => {
        const stateSlug = note.state?.toLowerCase().replace(/\s+/g, '-') || 'autre';
        return (
            <div className={`note-item state-${stateSlug}`} onDoubleClick={() => setIsEditing(true)}>
                <div className="note-content-wrapper">
                    <div className="note-header">
                        {note.state && note.state !== 'autre' && (
                            <strong className="note-category">{stateLabel || note.state}</strong>
                        )}
                        {note.date && <span className="note-date">🗓️ {new Date(note.date).toLocaleDateString('fr-FR')}</span>}
                        {note.time && <span className="note-time"><Clock size={13} /> {note.time.slice(0, 5)}</span>}
                        {note.location && <span className="note-location"><Navigation size={13} /> {note.location}</span>}
                    </div>
                    {note.text && <p className="note-text">{note.text}</p>}
                </div>
                <div className="note-actions-buttons">
                    <button onClick={() => setIsEditing(true)} className="edit-note-btn" title="Modifier">
                        <Pencil size={16} />
                    </button>
                    <button onClick={() => setIsConfirmOpen(true)} className="delete-note-btn" title="Supprimer">
                        <Trash2 size={16} />
                    </button>
                </div>
            </div>
        );
    };

    const NoteEditForm = () => (
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
                {isEditing ? <NoteEditForm /> : <NoteDisplay />}
                    <ConfirmModal
                        isOpen={isConfirmOpen}
                        onClose={() => setIsConfirmOpen(false)}
                        onConfirm={performDelete}
                        title="Supprimer la note"
                        message="Voulez-vous vraiment supprimer cette note ?"
                        confirmText="Supprimer"
                        type="danger"
                    />
        </>
    );
};

export default Note;