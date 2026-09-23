// components/plan/PlanDeClasse.js
// Plan de classe : on choisit une classe du journal, ses élèves arrivent dans
// la colonne « à placer », et on les installe sur les bancs.
//
// La disposition est rangée en base, une par classe, et suit donc
// l'enseignante d'un poste à l'autre. Chaque modification part au serveur
// après un court délai ; voir la section « Synchronisation ».
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    Users, Printer, Shuffle, Eraser, Palette, RotateCw,
    Plus, Minus, X, UserPlus, Armchair, LayoutGrid, Trash2, RefreshCw,
} from 'lucide-react';
import { useJournal } from '../../hooks/useJournal';
import { useClasses } from '../../hooks/useClasses';
import { useToast } from '../../hooks/useToast';
import StudentService from '../../services/StudentService';
import PlanService from '../../services/PlanService';
import ConfirmModal from '../ConfirmModal';
import {
    makePlan, seatOrder, countSeats, placedIds,
    resizeBlock, swapSeats, seatStudent, clearSeat, clearAllSeats,
    cycleTag, fillPlan, clonePlan, makeBlock, toggleSeatRemoved, DEFAULT_TAGS,
    isValidPlan, loadLegacyPlan, forgetLegacyPlan,
} from './planLayout';
import './PlanDeClasse.scss';

const LAST_CLASS_KEY = 'prolixe_plan_classId';

// Délai entre la dernière modification et l'envoi au serveur : un
// redimensionnement en quatre clics part en une seule requête.
const SAVE_DELAY_MS = 700;
const RETRY_DELAY_MS = 5000;

// Impression sur une seule page A4 paysage : place utile et dimensions des
// bancs, en millimètres — ce sont celles de la feuille d'impression
// (PlanDeClasse.scss, @media print), à garder en accord avec elle.
const PRINT = {
    width: 272,       // 297 - 2 × 10 de marge, moins une réserve
    height: 138,      // 210 - marges, titre, ligne de totaux et réserve
    seatW: 32, seatH: 16, seatGap: 2.5,
    blockGap: 9, blockHead: 8, roomGap: 7, board: 11,
};

// Échelle à appliquer à la salle pour qu'elle tienne en largeur comme en
// hauteur ; jamais d'agrandissement.
const printZoom = (plan) => {
    if (!plan?.blocks?.length) return 1;
    const span = (n, size) => n * size + Math.max(0, n - 1) * PRINT.seatGap;
    const width = plan.blocks.reduce((sum, b) => sum + span(b.cols, PRINT.seatW), 0)
        + (plan.blocks.length - 1) * PRINT.blockGap;
    const rows = Math.max(...plan.blocks.map(b => b.rows));
    const height = PRINT.blockHead + span(rows, PRINT.seatH) + PRINT.roomGap + PRINT.board;
    return Math.min(1, PRINT.width / width, PRINT.height / height);
};

const SYNC_LABELS = {
    loading: 'Chargement du plan…',
    saving: 'Enregistrement…',
    saved: 'Enregistré — disponible sur tous vos postes',
    offline: 'Serveur injoignable — nouvel essai dans quelques secondes',
    refused: 'Le serveur a refusé l’enregistrement',
};

const fullName = (student) =>
    [student?.firstname, student?.lastname].filter(Boolean).join(' ');

const PlanDeClasse = () => {
    const { currentJournal } = useJournal();
    const journalId = currentJournal?.id;
    const { classes, loading: loadingClasses } = useClasses(journalId);
    const { success, error, info } = useToast();

    const [classId, setClassId] = useState('');
    const [students, setStudents] = useState([]);
    const [loadingStudents, setLoadingStudents] = useState(false);

    // Le plan porte l'id de sa classe : l'effet d'enregistrement ne peut donc
    // pas écrire la disposition de la classe précédente sous la nouvelle.
    // `dirty` distingue une modification (à envoyer) d'un chargement.
    const [planState, setPlanState] = useState(null);
    const [syncStatus, setSyncStatus] = useState('loading');
    const [loadFailed, setLoadFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    // null, 'color' (cycler les pastilles) ou 'layout' (retirer des bancs).
    const [mode, setMode] = useState(null);
    const colorMode = mode === 'color';
    const layoutMode = mode === 'layout';
    // Sélection courante : { type: 'seat', bi, si } ou { type: 'student', id }.
    const [selection, setSelection] = useState(null);
    const [confirmModal, setConfirmModal] = useState({
        isOpen: false, title: '', message: '', onConfirm: null,
    });

    const plan = planState?.plan || null;
    const currentClass = classes.find(c => String(c.id) === String(classId));
    const currentClassName = currentClass?.name || 'cette classe';

    // ── Choix de la classe ────────────────────────────────────────────────────

    // À l'arrivée sur l'écran, on retrouve la dernière classe consultée ; à
    // défaut, la première du journal, pour ne pas afficher une salle vide.
    useEffect(() => {
        if (!classes.length) {
            setClassId('');
            return;
        }
        setClassId(prev => {
            if (prev && classes.some(c => String(c.id) === String(prev))) return prev;
            const remembered = localStorage.getItem(LAST_CLASS_KEY);
            const match = classes.find(c => String(c.id) === String(remembered));
            return String((match || classes[0]).id);
        });
    }, [classes]);

    useEffect(() => {
        if (classId) localStorage.setItem(LAST_CLASS_KEY, classId);
    }, [classId]);

    // ── Élèves de la classe ───────────────────────────────────────────────────

    useEffect(() => {
        let cancelled = false;
        if (!classId) {
            setStudents([]);
            return undefined;
        }
        setLoadingStudents(true);
        StudentService.getStudentsByClass(classId)
            .then(response => {
                if (!cancelled) setStudents(response.data.data || []);
            })
            .catch(() => {
                if (cancelled) return;
                setStudents([]);
                error('Erreur de chargement des élèves.');
            })
            .finally(() => {
                if (!cancelled) setLoadingStudents(false);
            });
        return () => { cancelled = true; };
    }, [classId, error]);

    // ── Synchronisation ───────────────────────────────────────────────────────
    // Une seule requête d'enregistrement à la fois. Ce qui est modifié pendant
    // qu'elle part attend dans `pending` — seul le dernier état compte, c'est
    // un document complet et non une suite d'opérations. `versions` garde, par
    // classe, la version en base sur laquelle on travaille.

    const sync = useRef({ pending: null, inFlight: false, timer: null, versions: {} });
    const activeClass = useRef('');
    activeClass.current = classId;

    const flush = useCallback(() => {
        const s = sync.current;
        clearTimeout(s.timer);
        s.timer = null;
        if (s.inFlight || !s.pending) return;

        const job = s.pending;
        const isActive = () => job.classId === activeClass.current;
        s.pending = null;
        s.inFlight = true;
        if (isActive()) setSyncStatus('saving');

        PlanService.savePlan(job.classId, job.plan, s.versions[job.classId] || 0)
            .then(response => {
                s.versions[job.classId] = response.data.data.version;
                if (job.fromLegacy) forgetLegacyPlan(job.classId);
                if (!s.pending && isActive()) setSyncStatus('saved');
            })
            .catch(err => {
                const status = err?.response?.status;
                if (status === 409) {
                    // Un autre poste a enregistré entre-temps : sa version
                    // l'emporte, plutôt que d'écraser un travail qu'on n'a pas vu.
                    const current = err.response.data?.data;
                    s.versions[job.classId] = current?.version || 0;
                    if (s.pending?.classId === job.classId) s.pending = null;
                    if (isActive()) {
                        if (isValidPlan(current?.layout)) {
                            setPlanState({ classId: job.classId, plan: current.layout, dirty: false });
                            setSelection(null);
                        }
                        setSyncStatus('saved');
                        info('Ce plan venait d’être modifié sur un autre poste : c’est cette version qui est affichée.');
                    }
                    return;
                }
                if (status && status < 500) {
                    // Refus du serveur (droits, format) : réessayer n'y changerait rien.
                    if (isActive()) setSyncStatus('refused');
                    error('Le plan n’a pas pu être enregistré.');
                    return;
                }
                // Panne réseau ou serveur : on garde ce plan et on réessaie,
                // sauf si une modification plus récente l'a déjà remplacé.
                if (!s.pending) s.pending = job;
                if (isActive()) setSyncStatus('offline');
                clearTimeout(s.timer);
                s.timer = setTimeout(() => flush(), RETRY_DELAY_MS);
            })
            .finally(() => {
                s.inFlight = false;
                if (s.pending && !s.timer) flush();
            });
    }, [error, info]);

    const scheduleSave = useCallback((job) => {
        const s = sync.current;
        s.pending = job;
        clearTimeout(s.timer);
        s.timer = setTimeout(() => flush(), SAVE_DELAY_MS);
    }, [flush]);

    // Changement de classe, départ de l'écran : ce qui attend part tout de suite.
    useEffect(() => () => flush(), [classId, flush]);

    // Fermer l'onglet avec une modification pas encore partie : le navigateur
    // demande confirmation.
    useEffect(() => {
        const onBeforeUnload = (event) => {
            const s = sync.current;
            if (s.pending || s.inFlight) {
                flush();
                event.preventDefault();
                event.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [flush]);

    // ── Disposition ───────────────────────────────────────────────────────────

    useEffect(() => {
        let cancelled = false;
        setSelection(null);
        setLoadFailed(false);
        setPlanState(null);
        if (!classId) return undefined;
        setSyncStatus('loading');

        PlanService.getPlan(classId)
            .then(response => {
                if (cancelled) return;
                const stored = response.data.data;
                if (stored && isValidPlan(stored.layout)) {
                    sync.current.versions[classId] = stored.version;
                    setPlanState({ classId, plan: stored.layout, dirty: false });
                    forgetLegacyPlan(classId);
                } else {
                    // Rien en base : on reprend le plan que ce navigateur gardait
                    // avant la synchronisation, et on l'envoie aussitôt.
                    sync.current.versions[classId] = stored?.version || 0;
                    const legacy = loadLegacyPlan(classId);
                    setPlanState(legacy
                        ? { classId, plan: legacy, dirty: true, fromLegacy: true }
                        : { classId, plan: makePlan(), dirty: false });
                }
                setSyncStatus('saved');
            })
            .catch(() => {
                if (cancelled) return;
                setLoadFailed(true);
                setSyncStatus('offline');
            });
        return () => { cancelled = true; };
    }, [classId, reloadKey]);

    useEffect(() => {
        if (!planState?.dirty) return;
        scheduleSave({
            classId: planState.classId,
            plan: planState.plan,
            fromLegacy: planState.fromLegacy,
        });
    }, [planState, scheduleSave]);

    // En revenant sur l'onglet après avoir travaillé sur un autre poste, on
    // relit le plan — sauf si une modification d'ici attend encore de partir.
    useEffect(() => {
        const refresh = () => {
            if (document.visibilityState !== 'visible' || !classId) return;
            const s = sync.current;
            if (s.pending || s.inFlight) return;
            PlanService.getPlan(classId)
                .then(response => {
                    const stored = response.data.data;
                    if (activeClass.current !== classId || s.pending || s.inFlight) return;
                    if (!stored || !isValidPlan(stored.layout)) return;
                    if (stored.version === s.versions[classId]) return;
                    s.versions[classId] = stored.version;
                    setPlanState({ classId, plan: stored.layout, dirty: false });
                    setSelection(null);
                })
                .catch(() => {});
        };
        window.addEventListener('focus', refresh);
        document.addEventListener('visibilitychange', refresh);
        return () => {
            window.removeEventListener('focus', refresh);
            document.removeEventListener('visibilitychange', refresh);
        };
    }, [classId]);

    const updatePlan = useCallback((recipe) => {
        setPlanState(prev => (prev
            ? { classId: prev.classId, plan: recipe(prev.plan), dirty: true }
            : prev));
    }, []);

    // ── Élèves placés / à placer ──────────────────────────────────────────────

    const byId = useMemo(() => {
        const map = new Map();
        students.forEach(s => map.set(String(s.id), s));
        return map;
    }, [students]);

    const placed = useMemo(() => (plan ? placedIds(plan) : new Set()), [plan]);

    // Un banc dont l'élève n'existe plus (supprimé dans Paramètres) se réaffiche
    // simplement comme libre : le prochain élève qu'on y assoit efface l'id mort.
    const seatOccupant = useCallback(
        (seat) => (seat.sid != null ? byId.get(String(seat.sid)) || null : null),
        [byId]
    );

    const unplaced = useMemo(
        () => students.filter(s => !placed.has(String(s.id))),
        [students, placed]
    );

    const seatedCount = useMemo(
        () => students.filter(s => placed.has(String(s.id))).length,
        [students, placed]
    );

    const totalSeats = plan ? countSeats(plan) : 0;
    const freeSeats = Math.max(0, totalSeats - seatedCount);

    // ── Interactions ──────────────────────────────────────────────────────────

    const askConfirm = (title, message, onConfirm) =>
        setConfirmModal({ isOpen: true, title, message, onConfirm });

    const closeConfirm = () =>
        setConfirmModal({ isOpen: false, title: '', message: '', onConfirm: null });

    const handleSeatClick = (bi, si) => {
        if (!plan) return;
        const target = { bi, si };

        if (layoutMode) {
            updatePlan(p => toggleSeatRemoved(p, target));
            return;
        }

        if (colorMode) {
            updatePlan(p => cycleTag(p, target));
            return;
        }

        if (selection?.type === 'student') {
            updatePlan(p => seatStudent(p, target, selection.id));
            setSelection(null);
            return;
        }

        if (selection?.type === 'seat') {
            if (selection.bi === bi && selection.si === si) {
                setSelection(null);
                return;
            }
            updatePlan(p => swapSeats(p, { bi: selection.bi, si: selection.si }, target));
            setSelection(null);
            return;
        }

        setSelection({ type: 'seat', bi, si });
    };

    const handleStudentClick = (studentId) => {
        if (selection?.type === 'seat') {
            updatePlan(p => seatStudent(p, { bi: selection.bi, si: selection.si }, studentId));
            setSelection(null);
            return;
        }
        setSelection(prev =>
            prev?.type === 'student' && String(prev.id) === String(studentId)
                ? null
                : { type: 'student', id: String(studentId) }
        );
    };

    // Glisser-déposer : un élève de la liste ou un banc occupé vers un banc,
    // ou un banc occupé vers la liste pour faire relever son élève.
    const onDropOnSeat = (event, bi, si) => {
        event.preventDefault();
        const payload = (event.dataTransfer.getData('text/plain') || '').split(':');
        if (payload[0] === 'student') {
            updatePlan(p => seatStudent(p, { bi, si }, payload[1]));
        } else if (payload[0] === 'seat') {
            updatePlan(p => swapSeats(
                p,
                { bi: Number(payload[1]), si: Number(payload[2]) },
                { bi, si }
            ));
        }
        setSelection(null);
    };

    const onDropOnRoster = (event) => {
        event.preventDefault();
        const payload = (event.dataTransfer.getData('text/plain') || '').split(':');
        if (payload[0] !== 'seat') return;
        updatePlan(p => clearSeat(p, { bi: Number(payload[1]), si: Number(payload[2]) }));
        setSelection(null);
    };

    const handleFill = (random) => {
        if (!plan) return;
        if (!students.length) {
            info("Cette classe n'a pas encore d'élèves — ajoutez-les dans Paramètres.");
            return;
        }

        // Le remplissage est calculé ici, pas dans le `setState` : React peut
        // rejouer une fonction de mise à jour, et on a besoin du nombre
        // d'élèves restés debout pour le signaler tout de suite.
        const run = () => {
            const result = fillPlan(plan, students.map(s => s.id), random);
            updatePlan(() => result.plan);
            setSelection(null);
            closeConfirm();
            if (result.left > 0) {
                error(`${result.left} élève(s) sans banc — ajoutez une rangée ou un îlot.`);
            } else {
                success(random ? 'Élèves mélangés sur les bancs.' : 'Élèves placés dans l’ordre de la liste.');
            }
        };

        if (seatedCount > 0) {
            askConfirm(
                random ? 'Mélanger les places' : 'Replacer tout le monde',
                `Les places actuelles de « ${currentClassName} » seront remplacées. Continuer ?`,
                run
            );
        } else {
            run();
        }
    };

    const handleClearAll = () => {
        askConfirm(
            'Vider les places',
            `Retirer tous les élèves des bancs de « ${currentClassName} » ? Les îlots restent en place.`,
            () => {
                updatePlan(p => clearAllSeats(p));
                setSelection(null);
                closeConfirm();
            }
        );
    };

    // Retirer une rangée ou une colonne peut faire disparaître le banc
    // sélectionné : on repart d'une sélection vide.
    const handleResize = (bi, dRows, dCols) => {
        updatePlan(p => resizeBlock(p, bi, dRows, dCols));
        setSelection(null);
    };

    const handleAddBlock = () =>
        updatePlan(p => {
            const next = clonePlan(p);
            next.blocks.push(makeBlock(4, 2, 'Nouvel îlot'));
            return next;
        });

    const handleRemoveBlock = (bi) => {
        if (!plan) return;
        if (plan.blocks.length < 2) {
            info('Gardez au moins un îlot.');
            return;
        }
        const block = plan.blocks[bi];
        askConfirm(
            'Supprimer l’îlot',
            `Supprimer « ${block.label} » et ses ${block.seats.filter(seat => !seat.x).length} places ?`,
            () => {
                updatePlan(p => {
                    const next = clonePlan(p);
                    next.blocks = next.blocks.filter((_, i) => i !== bi);
                    return next;
                });
                setSelection(null);
                closeConfirm();
            }
        );
    };

    const handleRenameBlock = (bi, label) =>
        updatePlan(p => {
            const next = clonePlan(p);
            next.blocks[bi].label = label;
            return next;
        });

    const handleRenameTag = (index, label) =>
        updatePlan(p => {
            const next = clonePlan(p);
            next.tags[index] = label;
            return next;
        });

    // ── Rendu ─────────────────────────────────────────────────────────────────

    const renderSeat = (block, bi, si) => {
        const seat = block.seats[si];
        const key = `${block.id}-${si}`;

        // Case retirée : elle garde sa position dans la grille pour que les
        // bancs voisins ne glissent pas. Visible seulement en mode aménagement.
        if (seat.x) {
            if (!layoutMode) return <div key={key} className="plan-seat gone" aria-hidden="true" />;
            return (
                <button
                    key={key}
                    type="button"
                    className="plan-seat gone restorable"
                    title="Remettre un banc ici"
                    aria-label="Remettre un banc ici"
                    onClick={() => handleSeatClick(bi, si)}
                >
                    <Plus size={16} />
                </button>
            );
        }

        const student = seatOccupant(seat);
        const isSelected = selection?.type === 'seat' && selection.bi === bi && selection.si === si;
        let label = student
            ? `${fullName(student)} — sélectionner pour échanger de place`
            : 'Place libre';
        if (layoutMode) {
            label = student
                ? `Retirer ce banc — ${fullName(student)} retournera dans la liste`
                : 'Retirer ce banc';
        }

        return (
            <div
                key={key}
                className={`plan-seat${student ? '' : ' free'}${isSelected ? ' selected' : ''}`}
                data-tag={student ? seat.t || 0 : 0}
                role="button"
                tabIndex={0}
                aria-label={label}
                aria-pressed={isSelected}
                title={label}
                draggable={Boolean(student) && !layoutMode}
                onClick={() => handleSeatClick(bi, si)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleSeatClick(bi, si);
                    }
                }}
                onContextMenu={(e) => {
                    e.preventDefault();
                    if (student && !layoutMode) updatePlan(p => cycleTag(p, { bi, si }));
                }}
                onDragStart={(e) => e.dataTransfer.setData('text/plain', `seat:${bi}:${si}`)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => onDropOnSeat(e, bi, si)}
            >
                {student ? (
                    <>
                        <span className="seat-who">
                            <span className="seat-firstname">{student.firstname}</span>
                            {student.lastname && <span className="seat-lastname">{student.lastname}</span>}
                        </span>
                        <button
                            type="button"
                            className="seat-clear"
                            aria-label={`Retirer ${fullName(student)} de ce banc`}
                            title="Libérer ce banc"
                            onClick={(e) => {
                                e.stopPropagation();
                                updatePlan(p => clearSeat(p, { bi, si }));
                                setSelection(null);
                            }}
                        >
                            <X size={12} />
                        </button>
                    </>
                ) : (
                    <span className="seat-empty">libre</span>
                )}
                {layoutMode && (
                    <span className="seat-remove" aria-hidden="true"><Trash2 size={16} /></span>
                )}
            </div>
        );
    };

    const renderBlock = (block, bi) => (
        <div className="plan-block" key={block.id} data-color={bi % 6}>
            <div className="block-head">
                {/* Le nom par défaut n'est remis qu'en quittant le champ : le
                    faire à chaque frappe empêcherait de tout effacer pour
                    retaper un autre nom. */}
                <input
                    value={block.label}
                    aria-label="Nom de l'îlot"
                    onChange={(e) => handleRenameBlock(bi, e.target.value)}
                    onBlur={(e) => handleRenameBlock(bi, e.target.value.trim() || 'Îlot')}
                />
                <button type="button" className="block-mini" title="Retirer une rangée"
                        aria-label="Retirer une rangée"
                        onClick={() => handleResize(bi, -1, 0)}>
                    <Minus size={12} />
                </button>
                <button type="button" className="block-mini" title="Ajouter une rangée"
                        aria-label="Ajouter une rangée"
                        onClick={() => handleResize(bi, 1, 0)}>
                    <Plus size={12} />
                </button>
                <button type="button" className="block-mini" title="Retirer une colonne"
                        aria-label="Retirer une colonne"
                        onClick={() => handleResize(bi, 0, -1)}>
                    ◧
                </button>
                <button type="button" className="block-mini" title="Ajouter une colonne"
                        aria-label="Ajouter une colonne"
                        onClick={() => handleResize(bi, 0, 1)}>
                    ◨
                </button>
                <button type="button" className="block-mini danger" title="Supprimer l'îlot"
                        aria-label="Supprimer l'îlot"
                        onClick={() => handleRemoveBlock(bi)}>
                    <X size={12} />
                </button>
            </div>

            <div className="block-grid" style={{ gridTemplateColumns: `repeat(${block.cols}, auto)` }}>
                {seatOrder(block, plan.rot).map(index => renderSeat(block, bi, index))}
            </div>
        </div>
    );

    if (!journalId) {
        return (
            <div className="plan-de-classe">
                <p className="plan-placeholder">Sélectionnez d'abord un journal de classe.</p>
            </div>
        );
    }

    return (
        <div className={`plan-de-classe${colorMode ? ' color-mode' : ''}${layoutMode ? ' layout-mode' : ''}`}>
            <header className="page-header">
                <div className="header-top">
                    <div className="header-title">
                        {/* Le sélecteur de classe disparaît à l'impression :
                            le nom est reporté sur le titre par la feuille
                            d'impression, via cet attribut. */}
                        <h2 data-class={currentClassName}>Plan de classe</h2>
                        <p className="header-sub">
                            Cliquez un élève puis un banc — ou glissez-le directement à sa place.
                            Deux bancs cliqués l'un après l'autre échangent leurs occupants.
                        </p>
                        <p className="print-meta">
                            Plan du {new Date().toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric' })}
                        </p>
                    </div>

                    <div className="class-picker">
                        <label htmlFor="plan-class"><Users size={14} /> Classe</label>
                        <select
                            id="plan-class"
                            value={classId}
                            onChange={(e) => setClassId(e.target.value)}
                            disabled={loadingClasses || !classes.length}
                        >
                            {!classes.length && <option value="">Aucune classe</option>}
                            {classes.map(c => (
                                <option key={c.id} value={c.id}>
                                    {c.name}{c.level ? ` — ${c.level}` : ''}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>
            </header>

            {!loadingClasses && !classes.length && (
                <p className="plan-placeholder">
                    Ce journal n'a pas encore de classe. Créez-en une dans Paramètres → Classes.
                </p>
            )}

            {loadFailed && (
                <div className="plan-placeholder">
                    <p>Le plan de « {currentClassName} » n'a pas pu être chargé depuis le serveur.</p>
                    <button type="button" className="tool" onClick={() => setReloadKey(k => k + 1)}>
                        <RefreshCw size={15} /> Réessayer
                    </button>
                </div>
            )}

            {!plan && !loadFailed && classId && (
                <p className="plan-placeholder">Chargement du plan…</p>
            )}

            {plan && (
                <>
                    <div className="plan-toolbar">
                        <button type="button" className="tool primary" onClick={() => handleFill(false)}>
                            <UserPlus size={15} /> Placer tout le monde
                        </button>
                        <button type="button" className="tool" onClick={() => handleFill(true)}>
                            <Shuffle size={15} /> Mélanger
                        </button>
                        <button type="button" className="tool" onClick={handleClearAll}>
                            <Eraser size={15} /> Vider les places
                        </button>

                        <span className="tool-sep" />

                        <button
                            type="button"
                            className={`tool${colorMode ? ' on' : ''}`}
                            aria-pressed={colorMode}
                            onClick={() => { setMode(m => (m === 'color' ? null : 'color')); setSelection(null); }}
                        >
                            <Palette size={15} /> Couleurs
                        </button>
                        <button
                            type="button"
                            className={`tool${layoutMode ? ' on' : ''}`}
                            aria-pressed={layoutMode}
                            title="Retirer ou remettre des bancs un par un"
                            onClick={() => { setMode(m => (m === 'layout' ? null : 'layout')); setSelection(null); }}
                        >
                            <LayoutGrid size={15} /> Aménager
                        </button>
                        <button type="button" className="tool"
                                title="Voir la salle depuis le fond de la classe"
                                onClick={() => updatePlan(p => ({ ...p, rot: !p.rot }))}>
                            <RotateCw size={15} /> Pivoter la vue
                        </button>
                        <button type="button" className="tool" onClick={handleAddBlock}>
                            <Plus size={15} /> Îlot
                        </button>

                        <span className="tool-sep" />

                        <button type="button" className="tool" onClick={() => window.print()}>
                            <Printer size={15} /> Imprimer
                        </button>

                        <span className={`tool-hint sync-${syncStatus}`} role="status" aria-live="polite">
                            {SYNC_LABELS[syncStatus]}
                        </span>
                    </div>

                    {colorMode && (
                        <p className="plan-note">
                            Mode couleurs : chaque clic sur un banc change sa pastille.
                            Les intitulés se modifient dans la légende.
                        </p>
                    )}

                    {layoutMode && (
                        <p className="plan-note">
                            Mode aménagement : cliquez un banc pour le retirer, une case en
                            pointillés pour le remettre. Un élève assis sur un banc retiré
                            retourne dans la liste « à placer ».
                        </p>
                    )}

                    <div className="plan-cols">
                        <section className="room-card">
                            <div
                                className={`plan-room${plan.rot ? ' rotated' : ''}`}
                                style={{ '--print-zoom': printZoom(plan) }}
                            >
                                <div className="room-blocks">
                                    {plan.blocks.map((block, bi) => renderBlock(block, bi))}
                                </div>
                                <div className="room-boardrow">
                                    <div className="room-board">Tableau</div>
                                    <div className="room-desk">Bureau</div>
                                </div>
                            </div>

                            <div className="room-stats">
                                <span><b>{seatedCount}</b> élève{seatedCount > 1 ? 's' : ''} placé{seatedCount > 1 ? 's' : ''}</span>
                                <span><b>{freeSeats}</b> place{freeSeats > 1 ? 's' : ''} libre{freeSeats > 1 ? 's' : ''}</span>
                                <span><b>{totalSeats}</b> banc{totalSeats > 1 ? 's' : ''} · {plan.blocks.length} îlot{plan.blocks.length > 1 ? 's' : ''}</span>
                            </div>
                        </section>

                        <aside className="plan-side">
                            <div className="side-card">
                                <h3><Armchair size={15} /> À placer ({unplaced.length})</h3>
                                <div
                                    className="roster"
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={onDropOnRoster}
                                >
                                    {loadingStudents && <p className="side-empty">Chargement…</p>}

                                    {!loadingStudents && !students.length && (
                                        <p className="side-empty">
                                            Aucun élève dans cette classe. Ajoutez-les dans Paramètres → Élèves.
                                        </p>
                                    )}

                                    {!loadingStudents && students.length > 0 && !unplaced.length && (
                                        <p className="side-empty">
                                            Tout le monde est assis. Glissez un banc ici pour faire relever un élève.
                                        </p>
                                    )}

                                    {unplaced.map(student => {
                                        const isSelected = selection?.type === 'student'
                                            && String(selection.id) === String(student.id);
                                        return (
                                            <button
                                                key={student.id}
                                                type="button"
                                                className={`roster-name${isSelected ? ' selected' : ''}`}
                                                aria-pressed={isSelected}
                                                draggable
                                                onDragStart={(e) => e.dataTransfer.setData('text/plain', `student:${student.id}`)}
                                                onClick={() => handleStudentClick(student.id)}
                                            >
                                                {fullName(student)}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="side-card">
                                <h3><Palette size={15} /> Légende des couleurs</h3>
                                <div className="legend">
                                    {(plan.tags || DEFAULT_TAGS).map((tag, i) => (
                                        <div className="legend-line" key={i} data-tag={i + 1}>
                                            <i aria-hidden="true" />
                                            <input
                                                value={tag}
                                                aria-label={`Intitulé de la couleur ${i + 1}`}
                                                onChange={(e) => handleRenameTag(i, e.target.value)}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </aside>
                    </div>
                </>
            )}

            <ConfirmModal
                isOpen={confirmModal.isOpen}
                title={confirmModal.title}
                message={confirmModal.message}
                onClose={closeConfirm}
                onConfirm={confirmModal.onConfirm || closeConfirm}
                confirmText="Confirmer"
            />
        </div>
    );
};

export default PlanDeClasse;
