import React, { useState, useEffect, useCallback } from 'react';
import NoteService from '../../services/NoteService';
import Note from './Note';
import { useJournal } from '../../hooks/useJournal';
import './NoteSection.scss';

const formatDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const STATE_LABELS = {
    'todo':                 'À faire (TODO)',
    'cap':                  'CAP',
    'conseil-de-classe':    'Conseil de classe',
    'réunions-de-parents':  'Réunion parents',
    'autre':                'Autre',
};

const NotesSection = () => {
    const { currentJournal } = useJournal();
    const journalId = currentJournal?.id;

    const [notes, setNotes] = useState([]);
    const [newNoteText, setNewNoteText] = useState('');
    const [newNoteState, setNewNoteState] = useState('autre');
    const [newNoteDate, setNewNoteDate] = useState(formatDate(new Date()));
    const [newNoteTime, setNewNoteTime] = useState('');
    const [newNoteLocation, setNewNoteLocation] = useState('');
    const [loading, setLoading] = useState(true);

    const fetchNotes = useCallback(async () => {
        if (!journalId) return;
        try {
            setLoading(true);
            const response = await NoteService.getNotes(journalId);
            const fetchedNotes = Array.isArray(response) ? response : (response?.data || []);
            setNotes(fetchedNotes);
        } catch (error) {
            console.error("Erreur notes:", error);
            setNotes([]);
        } finally {
            setLoading(false);
        }
    }, [journalId]);

    useEffect(() => { fetchNotes(); }, [fetchNotes]);

    const isFormInvalid = !newNoteText.trim();

    const handleAddNote = async (e) => {
        e.preventDefault();
        if (isFormInvalid || !journalId) return;
        try {
            const response = await NoteService.addNote(
                journalId,
                newNoteText,
                newNoteState,
                newNoteDate,
                newNoteTime,
                newNoteLocation
            );
            setNotes(prev => [response?.data || response, ...prev]);
            setNewNoteText('');
            setNewNoteState('autre');
            setNewNoteDate(formatDate(new Date()));
            setNewNoteTime('');
            setNewNoteLocation('');
        } catch (error) {
            console.error(error);
        }
    };

    if (!journalId) return (
        <div className="dashboard-section">
            <p>Sélectionnez un journal.</p>
        </div>
    );

    return (
        <div className="dashboard-section notes-section">
            <div className="section-header">
                <h2>📌 Notes & Tâches ({currentJournal.name})</h2>
            </div>

            <div className="notes-widget">
                <div className="notes-list-container">
                    {loading ? (
                        <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>Chargement...</p>
                    ) : notes.length === 0 ? (
                        <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>Aucune note pour ce journal.</p>
                    ) : (
                        notes.map(note => (
                            <Note
                                key={note.id}
                                note={note}
                                stateLabel={STATE_LABELS[note.state] || note.state || 'Autre'}
                                onDelete={fetchNotes}
                                onUpdate={fetchNotes}
                            />
                        ))
                    )}
                </div>
                <form onSubmit={handleAddNote} className="note-input-area">
                    <textarea
                        value={newNoteText}
                        onChange={(e) => setNewNoteText(e.target.value)}
                        placeholder="Une idée ou une tâche à faire..."
                    />

                    <div className="note-form-grid">
                        <select
                            className={`state-select state-${newNoteState.replace(/\s+/g, '-')}`}
                            value={newNoteState}
                            onChange={(e) => setNewNoteState(e.target.value)}
                        >
                            <option value="autre">Autre</option>
                            <option value="todo">À faire (TODO)</option>
                            <option value="cap">CAP</option>
                            <option value="conseil-de-classe">Conseil de classe</option>
                            <option value="réunions-de-parents">Réunion parents</option>
                        </select>

                        <input
                            type="date"
                            value={newNoteDate}
                            onChange={(e) => setNewNoteDate(e.target.value)}
                        />
                        <input
                            type="time"
                            value={newNoteTime}
                            onChange={(e) => setNewNoteTime(e.target.value)}
                        />
                        <input
                            type="text"
                            placeholder="Lieu"
                            value={newNoteLocation}
                            onChange={(e) => setNewNoteLocation(e.target.value)}
                        />

                        <button type="submit" className="add-note-btn" disabled={isFormInvalid}>
                            Ajouter
                        </button>
                    </div>
                </form>

            </div>
        </div>
    );
};

export default NotesSection;