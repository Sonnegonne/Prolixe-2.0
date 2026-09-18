// client/src/hooks/useJournal.js
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import JournalService from '../services/JournalService';
import { useAuth } from './useAuth';
import { useSchools } from './useSchools';

const JournalContext = createContext(null);

// Le dernier journal consulte est retenu **par ecole** : revenir dans un
// etablissement doit rouvrir le journal qu'on y avait laisse, pas celui de
// l'autre. L'ancienne cle unique sert encore de repli le temps d'une session.
const LEGACY_JOURNAL_KEY = 'prolixe_currentJournalId';
const journalKeyFor = (schoolId) => `prolixe_currentJournalId_${schoolId || 'none'}`;

export const JournalProvider = ({ children }) => {
    const { isAuthenticated } = useAuth();
    const { currentSchoolId, loading: loadingSchools } = useSchools();
    const [journals, setJournals] = useState([]);
    const [currentJournal, setCurrentJournal] = useState(null);
    const [archivedJournals, setArchivedJournals] = useState([]);
    const [journalEntries, setJournalEntries] = useState([]);
    const [assignments, setAssignments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Choisit le journal a ouvrir dans une ecole donnee. Un journal sans ecole
    // (base pas encore migree, ou aucune ecole enregistree) reste eligible :
    // mieux vaut un journal que rien du tout.
    const pickJournalForSchool = useCallback((all, schoolId) => {
        const inSchool = j => !schoolId || j.school_id === schoolId || j.school_id == null;
        const candidates = all.filter(j => !j.is_archived && inSchool(j));
        if (candidates.length === 0) return null;

        const storedId = parseInt(
            localStorage.getItem(journalKeyFor(schoolId)) || localStorage.getItem(LEGACY_JOURNAL_KEY),
            10
        );
        return candidates.find(j => j.id === storedId)
            || candidates.find(j => j.is_current)
            || candidates[0];
    }, []);

    // Le chargement ne choisit plus le journal : c'est l'effet ci-dessous qui
    // s'en charge, pour que changer d'ecole rebascule le journal sans refaire
    // un aller-retour reseau.
    const loadAllJournals = useCallback(async () => {
        setLoading(true);
        try {
            let response = await JournalService.getAllJournals();
            response = response.data;
            const all = response.data || [];
            setJournals(all);
            setArchivedJournals(all.filter(j => j.is_archived));
        } catch (err) {
            setError(err.message || "Erreur lors du chargement des journaux.");
        } finally {
            setLoading(false);
        }
    }, []);

    // On (re)charge les journaux dès que l'utilisateur est authentifié
    // (login OU session restaurée au refresh). Évite le fetch pré-auth qui
    // échouait faute de token et laissait currentJournal à null jusqu'au refresh.
    useEffect(() => {
        if (isAuthenticated) {
            loadAllJournals();
        } else {
            // Déconnexion : on repart d'un état propre.
            setCurrentJournal(null);
            setJournals([]);
            setJournalEntries([]);
            setAssignments([]);
            setLoading(false);
        }
    }, [isAuthenticated, loadAllJournals]);

    // Le journal courant suit l'ecole choisie. On ne touche a rien tant que le
    // journal en place appartient deja a cette ecole : sans ce garde-fou, la
    // selection manuelle de l'utilisatrice serait ecrasee a chaque rendu.
    useEffect(() => {
        if (!isAuthenticated || loadingSchools || journals.length === 0) return;
        // Un journal archive volontairement ouvert (consultation) reste en
        // place tant qu'il releve de l'ecole affichee.
        if (currentJournal
            && (!currentSchoolId || currentJournal.school_id === currentSchoolId || currentJournal.school_id == null)) {
            return;
        }
        setCurrentJournal(pickJournalForSchool(journals, currentSchoolId));
    }, [isAuthenticated, loadingSchools, journals, currentSchoolId, currentJournal, pickJournalForSchool]);

    const selectJournal = (journal) => {
        if (journal && journal.id) {
            setCurrentJournal(journal);
            localStorage.setItem(journalKeyFor(journal.school_id), journal.id);
            localStorage.setItem(LEGACY_JOURNAL_KEY, journal.id);
        }
    };

    const clearJournal = useCallback(async (journalId) => {
        try {
            await JournalService.clearJournal(journalId);
            if (currentJournal && currentJournal.id === journalId) {
                setJournalEntries([]);
            }
        } catch (err) {
            throw err;
        }
    }, [currentJournal]);

    const createJournal = useCallback(async (journalData) => {
        try {
            let response = await JournalService.createJournal(journalData);
            response = response.data;
            await loadAllJournals();
            return response.data;
        } catch (err) {
            setError(err.message || "Erreur lors de la création du journal.");
            throw err;
        }
    }, [loadAllJournals]);

    const archiveJournal = useCallback(async (journalId) => {
        try {
            await JournalService.archiveJournal(journalId);
            await loadAllJournals();
        } catch (err) {
            setError(err.message || "Erreur lors de l'archivage du journal.");
            throw err;
        }
    }, [loadAllJournals]);

    const deleteArchivedJournal = useCallback(async (journalId) => {
        try {
            await JournalService.deleteJournal(journalId);
            await loadAllJournals();
        } catch (err) {
            setError(err.message || "Erreur lors de la suppression du journal.");
            throw err;
        }
    }, [loadAllJournals]);

    const fetchJournalEntries = useCallback(async (startDate, endDate) => {
        if (!startDate || !endDate || !currentJournal) return;
        setLoading(true);
        setError(null);
        try {
            let response = await JournalService.getJournalEntries(startDate, endDate, currentJournal.id);
            response = response.data;
            setJournalEntries(response.data || []);
        } catch (err) {
            setError(err.message || 'Erreur lors de la récupération des entrées du journal.');
        } finally {
            setLoading(false);
        }
    }, [currentJournal]);

    const fetchAssignments = useCallback(async (startDate, endDate) => {
        if (!currentJournal) {
            setAssignments([]);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            // Suppression de classId qui décalait les arguments
            let response = await JournalService.getAssignments(currentJournal.id, startDate, endDate);
            setAssignments(response.data.data || []);
        } catch (err) {
            setError(err.message || 'Erreur lors de la récupération des devoirs.');
        } finally {
            setLoading(false);
        }
    }, [currentJournal]);
    /**
     * ADAPTATION : Mappage des champs pour correspondre au JournalController SQL
     */
    const upsertJournalEntry = useCallback(async (entryData) => {
        if (!currentJournal) throw new Error("Aucun journal sélectionné.");
        if (currentJournal.is_archived) throw new Error("Impossible de modifier un journal archivé.");
        setError(null);
        try {
            // Mappage des noms de champs du Frontend vers le Backend (SQL)
            const mappedData = {
                id: entryData.id,
                journal_id: currentJournal.id,
                schedule_slot_id: entryData.schedule_slot_id || entryData.schedule_id,
                entry_date: entryData.date,           // backend attend entry_date
                content_planned: entryData.planned_work, // backend attend content_planned
                content_done: entryData.actual_work,     // backend attend content_done
                homework: entryData.notes             // backend attend homework
            };

            let response = await JournalService.upsertJournalEntry(mappedData);
            response = response.data;

            // On récupère l'ID généré si c'était une création
            const savedEntry = { ...mappedData, id: response.data.id || mappedData.id };

            setJournalEntries(prev => {
                const index = prev.findIndex(e => e.id === savedEntry.id);
                if (index > -1) {
                    const newEntries = [...prev];
                    newEntries[index] = savedEntry;
                    return newEntries;
                }
                return [...prev, savedEntry];
            });
            return savedEntry;
        } catch (err) {
            setError(err.message || "Erreur lors de la sauvegarde de l'entrée de journal.");
            throw err;
        }
    }, [currentJournal]);

    const deleteJournalEntry = useCallback(async (id) => {
        if (currentJournal && currentJournal.is_archived) throw new Error("Impossible de modifier un journal archivé.");
        setError(null);
        try {
            await JournalService.deleteJournalEntry(id);
            setJournalEntries(prev => prev.filter(a => a.id !== id));
        } catch (err) {
            setError(err.message || "Erreur lors de la suppression de l'entrée de journal.");
            throw err;
        }
    }, [currentJournal]);

    const upsertAssignment = useCallback(async (assignmentData) => {
        if (!currentJournal) throw new Error("Aucun journal sélectionné.");
        if (currentJournal.is_archived) throw new Error("Impossible de modifier un journal archivé.");
        setError(null);
        try {
            const dataWithJournalId = { ...assignmentData, journal_id: currentJournal.id };
            let response = await JournalService.upsertAssignment(dataWithJournalId);
            response = response.data;
            const newAssignment = response.data;
            setAssignments(prev => {
                const existingIndex = prev.findIndex(a => a.id === newAssignment.id);
                if (existingIndex > -1) {
                    return prev.map((a, i) => (i === existingIndex ? newAssignment : a));
                }
                return [...prev, newAssignment].sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
            });
            return newAssignment;
        } catch (err) {
            setError(err.message || "Erreur lors de la sauvegarde du devoir.");
            throw err;
        }
    }, [currentJournal]);

    const deleteAssignment = useCallback(async (id) => {
        if (currentJournal && currentJournal.is_archived) throw new Error("Impossible de modifier un journal archivé.");
        setError(null);
        try {
            await JournalService.deleteAssignment(id);
            setAssignments(prev => prev.filter(a => a.id !== id));
        } catch (err) {
            setError(err.message || "Erreur lors de la suppression du devoir.");
            throw err;
        }
    }, [currentJournal]);

    const value = {
        journals, currentJournal, archivedJournals, selectJournal, loadAllJournals, createJournal, archiveJournal, deleteArchivedJournal,
        journalEntries, assignments, loading, error, fetchJournalEntries, fetchAssignments,
        upsertJournalEntry, deleteJournalEntry, upsertAssignment, deleteAssignment, clearJournal
    };

    return <JournalContext.Provider value={value}>{children}</JournalContext.Provider>;
};

export const useJournal = () => {
    const context = useContext(JournalContext);
    if (!context) {
        throw new Error('useJournal doit être utilisé à l\'intérieur d\'un JournalProvider');
    }
    return context;
};