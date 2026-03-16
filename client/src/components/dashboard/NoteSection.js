import React, { useState, useEffect, useCallback } from 'react';
import NoteService from '../../services/NoteService';
import Note from './Note';

// Fonction utilitaire pour formater la date au format YYYY-MM-DD
const formatDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const NotesSection = () => {
    const [notes, setNotes] = useState([]);
    const [newNoteText, setNewNoteText] = useState('');
    const [newNoteState, setNewNoteState] = useState('autre');
    const [newNoteDate, setNewNoteDate] = useState(formatDate(new Date()));
    const [newNoteTime, setNewNoteTime] = useState('');
    const [newNoteLocation, setNewNoteLocation] = useState('');
    const [loading, setLoading] = useState(true);

    // Récupération des notes
    const fetchNotes = useCallback(async () => {
        try {
            setLoading(true);
            const response = await NoteService.getNotes();
            // On gère le cas où l'API renvoie { data: [...] } ou directement [...]
            const fetchedNotes = Array.isArray(response) ? response : (response?.data || []);
            setNotes(fetchedNotes);
        } catch (error) {
            console.error("Erreur lors de la récupération des notes:", error);
            setNotes([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchNotes();
    }, [fetchNotes]);

    // Validation : On autorise l'ajout si le texte est présent OU si une info (date/heure/local) est saisie
    const isFormInvalid = !newNoteText.trim() && !newNoteTime && !newNoteLocation;

    const handleAddNote = async (event) => {
        event.preventDefault();

        if (isFormInvalid) return;

        try {
            const response = await NoteService.addNote(
                newNoteText,
                newNoteState,
                newNoteDate,
                newNoteTime,
                newNoteLocation
            );

            // On récupère la nouvelle note (souvent dans response.data)
            const newNote = response?.data || response;

            setNotes(prevNotes => [newNote, ...prevNotes]);

            // Reset du formulaire
            setNewNoteText('');
            setNewNoteState('autre');
            setNewNoteDate(formatDate(new Date()));
            setNewNoteTime('');
            setNewNoteLocation('');
        } catch (error) {
            console.error("Erreur lors de l'ajout de la note:", error);
        }
    };

    const handleDeleteNote = async (id) => {
        try {
            await NoteService.deleteNote(id);
            setNotes(prevNotes => prevNotes.filter((note) => note.id !== id));
        } catch (error) {
            console.error("Erreur lors de la suppression de la note:", error);
        }
    };

    const handleUpdateNote = (updatedNote) => {
        setNotes(prevNotes => prevNotes.map(note => note.id === updatedNote.id ? updatedNote : note));
    };

    if (loading) {
        return <div className="dashboard-section loading"><p>Chargement des notes...</p></div>;
    }

    return (
        <div className="dashboard-section notes-section">
            <div className="section-header">
                <h2>📌 Notes rapides</h2>
            </div>

            <div className="notes-widget">
                <form onSubmit={handleAddNote} className="note-input-area">
                    <textarea
                        value={newNoteText}
                        onChange={(e) => setNewNoteText(e.target.value)}
                        placeholder="Une idée, un rappel..."
                        rows="2"
                    />

                    <div className="note-controls">
                        <div className="input-row">
                            <select
                                className={`note-state-select state-${newNoteState.replace(/\s+/g, '-').toLowerCase()}`}
                                value={newNoteState}
                                onChange={(e) => setNewNoteState(e.target.value)}
                            >
                                <option value="autre">Autre</option>
                                <option value="cap">CAP</option>
                                <option value="conseil de classe">Conseil de classe</option>
                                <option value="réunions de parents">Réunions de parents</option>
                            </select>

                            <input
                                type="date"
                                className="note-date-input"
                                value={newNoteDate}
                                onChange={(e) => setNewNoteDate(e.target.value)}
                            />
                        </div>

                        <div className="input-row">
                            <input
                                type="time"
                                className="note-time-input"
                                value={newNoteTime}
                                onChange={(e) => setNewNoteTime(e.target.value)}
                            />
                            <input
                                type="text"
                                className="note-location-input"
                                value={newNoteLocation}
                                onChange={(e) => setNewNoteLocation(e.target.value)}
                                placeholder="Local"
                            />
                            <button
                                type="submit"
                                className="add-note-btn"
                                disabled={isFormInvalid}
                            >
                                Ajouter
                            </button>
                        </div>
                    </div>
                </form>

                <div className="notes-list-container">
                    {notes && notes.length > 0 ? (
                        notes.map((note) => (
                            <Note
                                key={note.id}
                                note={note}
                                onDelete={handleDeleteNote}
                                onUpdate={handleUpdateNote}
                            />
                        ))
                    ) : (
                        <div className="empty-notes-message">
                            <p>Aucune note pour le moment.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default NotesSection;