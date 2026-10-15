import { useState, useEffect, useCallback, useRef } from 'react';
import { getConseilDataBySession, saveStudentConseil } from '../services/ConseilClasseService';

const SAVE_DELAY = 1000;

export const useConseilDeClasse = (sessionId, classId) => {
    const [students, setStudents] = useState([]);
    const [loading, setLoading] = useState(false);
    const [savingStatus, setSavingStatus] = useState({});

    // Le serveur réécrit notes ET décision à chaque envoi : on envoie donc
    // toujours la fiche complète, lue ici (à jour sans attendre un rendu).
    const studentsRef = useRef([]);
    // Un minuteur par élève : passer vite d'un élève à l'autre ne fait plus
    // tomber la saisie du précédent.
    const timersRef = useRef({});
    // Envois sérialisés par élève, pour qu'une réponse lente n'écrase pas une plus récente.
    const chainsRef = useRef({});

    const saveNow = useCallback((sid, studentId) => {
        clearTimeout(timersRef.current[studentId]);
        delete timersRef.current[studentId];
        const student = studentsRef.current.find(s => s.id === studentId);
        if (!sid || !student) return Promise.resolve();

        const payload = { notes: student.notes || '', decision: student.decision || 'AO-A' };
        const run = async () => {
            setSavingStatus(prev => ({ ...prev, [studentId]: 'saving' }));
            try {
                await saveStudentConseil(sid, studentId, payload);
                setSavingStatus(prev => ({ ...prev, [studentId]: 'saved' }));
            } catch {
                setSavingStatus(prev => ({ ...prev, [studentId]: 'error' }));
            }
        };
        const next = (chainsRef.current[studentId] || Promise.resolve()).then(run);
        chainsRef.current[studentId] = next;
        return next;
    }, []);

    const flushAll = useCallback((sid) => {
        const pending = Object.keys(timersRef.current).map(Number);
        return Promise.all(pending.map(id => saveNow(sid, id)));
    }, [saveNow]);

    useEffect(() => {
        if (!sessionId || !classId) {
            studentsRef.current = [];
            setStudents([]);
            return;
        }

        let cancelled = false;
        const fetchData = async () => {
            setLoading(true);
            try {
                const res = await getConseilDataBySession(sessionId, classId);
                if (cancelled) return;
                studentsRef.current = res.data.data;
                setStudents(res.data.data);
                setSavingStatus({});
            } finally { if (!cancelled) setLoading(false); }
        };
        fetchData();

        // Changement de période/classe ou sortie de l'écran : on envoie ce qui attend encore.
        return () => {
            cancelled = true;
            flushAll(sessionId);
        };
    }, [sessionId, classId, flushAll]);

    // Fermeture de l'onglet avec une saisie pas encore partie : prévenir.
    useEffect(() => {
        const onBeforeUnload = (e) => {
            if (Object.keys(timersRef.current).length === 0) return;
            flushAll(sessionId);
            e.preventDefault();
            e.returnValue = '';
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [sessionId, flushAll]);

    const handleStudentChange = useCallback((studentId, field, value) => {
        studentsRef.current = studentsRef.current.map(s => s.id === studentId ? { ...s, [field]: value } : s);
        setStudents(studentsRef.current);
        setSavingStatus(prev => ({ ...prev, [studentId]: 'pending' }));
        clearTimeout(timersRef.current[studentId]);
        timersRef.current[studentId] = setTimeout(() => saveNow(sessionId, studentId), SAVE_DELAY);
    }, [sessionId, saveNow]);

    // Enregistre tout de suite un élève (bouton « Élève suivant », fermeture de la vue en grand).
    const saveStudent = useCallback((studentId) => {
        if (!(studentId in timersRef.current)) return chainsRef.current[studentId] || Promise.resolve();
        return saveNow(sessionId, studentId);
    }, [sessionId, saveNow]);

    return { students, loading, savingStatus, handleStudentChange, saveStudent };
};
