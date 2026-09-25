import React, { useState, useEffect, useCallback, useMemo } from 'react';
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

// Ordre d'affichage : rendez-vous et tâches à venir (du plus proche au plus
// lointain), puis les notes sans date, puis ce qui est passé — grisé, en bas.
const sortNotes = (notes, today) => {
    const rank = (note) => (!note.date ? 1 : note.date < today ? 2 : 0);
    return [...notes].sort((a, b) =>
        rank(a) - rank(b)
        || (rank(a) === 2
            ? String(b.date).localeCompare(String(a.date))
            : String(a.date || '').localeCompare(String(b.date || '')))
        || String(a.time || '99').localeCompare(String(b.time || '99'))
    );
};

const NotesSection = ({ onChange }) => {
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

    // Toute modification peut créer, déplacer ou supprimer un rendez-vous du
    // jour : le tableau de bord recharge alors sa journée.
    const refresh = useCallback(async () => {
        await fetchNotes();
        onChange?.();
    }, [fetchNotes, onChange]);

    const today = formatDate(new Date());
    const sortedNotes = useMemo(() => sortNotes(notes, today), [notes, today]);
    const isAppointment = Boolean(newNoteDate && newNoteTime);

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
            onChange?.();
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
                        sortedNotes.map(note => (
                            <Note
                                key={note.id}
                                note={note}
                                isPast={Boolean(note.date) && note.date < today}
                                stateLabel={STATE_LABELS[note.state] || note.state || 'Autre'}
                                onDelete={refresh}
                                onUpdate={refresh}
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
                            aria-label="Heure (en fait un rendez-vous)"
                            title="Avec une heure, la note devient un rendez-vous"
                        />
                        <input
                            type="text"
                            placeholder="Lieu"
                            value={newNoteLocation}
                            onChange={(e) => setNewNoteLocation(e.target.value)}
                        />

                        <button type="submit" className="add-note-btn" disabled={isFormInvalid}>
                            {isAppointment ? 'Ajouter le rendez-vous' : 'Ajouter'}
                        </button>
                    </div>
                    {isAppointment && (
                        <p className="note-rdv-hint">
                            📅 Rendez-vous le {new Date(`${newNoteDate}T00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} à {newNoteTime}
                            {newNoteDate === today && ' — il apparaîtra dans votre journée.'}
                        </p>
                    )}
                </form>

            </div>
        </div>
    );
};

export default NotesSection;