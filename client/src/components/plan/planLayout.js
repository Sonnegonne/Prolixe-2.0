// components/plan/planLayout.js
// Modèle de données du plan de classe : îlots et bancs.
//
// Un banc ne garde qu'un `sid` (l'id de l'élève dans STUDENTS) : les prénoms
// affichés viennent toujours de la base, donc renommer un élève dans Paramètres
// met le plan à jour tout seul, et un élève supprimé libère sa place.
//
// Un îlot reste une grille rangées × colonnes, mais chaque case peut être
// retirée (`x: true`) : la case garde sa position, ce qui laisse dessiner un
// îlot en L ou une rangée plus courte sans décaler les autres bancs.
//
// Le plan est rangé en base (PlanService). L'ancien rangement dans le
// navigateur n'est plus lu que pour reprendre les plans créés avant.

const LEGACY_STORAGE_KEY = 'prolixe_plan_de_classe_v1';
const LEGACY_VERSION = 1;

// 0 = pas de couleur, puis les trois intitulés de la légende.
export const TAG_COUNT = 4;
export const DEFAULT_TAGS = ['Suivi rapproché', 'Aide ponctuelle', 'Tutrice / tuteur'];

const MAX_ROWS = 12;
const MAX_COLS = 10;

const uid = () => Math.random().toString(36).slice(2, 9);

export const makeBlock = (rows, cols, label) => ({
    id: uid(),
    label: label || 'Îlot',
    rows,
    cols,
    seats: Array.from({ length: rows * cols }, () => ({ sid: null, t: 0 })),
});

export const makePlan = () => ({
    rot: false,
    tags: [...DEFAULT_TAGS],
    blocks: [makeBlock(4, 4, 'Îlot fenêtres'), makeBlock(4, 2, 'Îlot porte')],
});

// Copie profonde légère : quelques dizaines de bancs, donc inutile de viser
// plus fin. Toute modification passe par là pour rester immutable côté React.
export const clonePlan = (plan) => ({
    ...plan,
    tags: [...(plan.tags || DEFAULT_TAGS)],
    blocks: plan.blocks.map(b => ({ ...b, seats: b.seats.map(s => ({ ...s })) })),
});

// ── Ancien rangement dans le navigateur ───────────────────────────────────────
// Les premiers plans vivaient dans le localStorage d'un seul poste. On les
// reprend une fois, à la première ouverture de la classe, puis on les oublie.

const readLegacy = () => {
    try {
        const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && parsed.v === LEGACY_VERSION && parsed.plans ? parsed.plans : {};
    } catch (err) {
        return {};
    }
};

export const isValidPlan = (plan) => Boolean(
    plan && Array.isArray(plan.blocks) && plan.blocks.length
    && plan.blocks.every(b => b && Array.isArray(b.seats) && b.seats.length === b.rows * b.cols)
);

export const loadLegacyPlan = (classId) => {
    const stored = readLegacy()[String(classId)];
    return isValidPlan(stored) ? stored : null;
};

export const forgetLegacyPlan = (classId) => {
    try {
        const plans = readLegacy();
        if (!(String(classId) in plans)) return;
        delete plans[String(classId)];
        if (Object.keys(plans).length) {
            localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ v: LEGACY_VERSION, plans }));
        } else {
            localStorage.removeItem(LEGACY_STORAGE_KEY);
        }
    } catch (err) {
        // Au pire, le plan local sera proposé à nouveau : il ne remplace
        // jamais un plan déjà en base.
    }
};

// ── Parcours des bancs ────────────────────────────────────────────────────────

// Ordre d'affichage d'un îlot. Vue pivotée : on lit la salle depuis le fond,
// donc rangées et colonnes sont inversées.
export const seatOrder = (block, rot) => {
    const order = [];
    for (let r = 0; r < block.rows; r++) {
        for (let c = 0; c < block.cols; c++) {
            const rr = rot ? block.rows - 1 - r : r;
            const cc = rot ? block.cols - 1 - c : c;
            order.push(rr * block.cols + cc);
        }
    }
    return order;
};

export const countSeats = (plan) =>
    plan.blocks.reduce((total, b) => total + b.seats.filter(s => !s.x).length, 0);

export const placedIds = (plan) => {
    const ids = new Set();
    plan.blocks.forEach(b => b.seats.forEach(s => {
        if (s.sid != null) ids.add(String(s.sid));
    }));
    return ids;
};

// Localise un élève dans la salle : { bi, si } ou null.
export const findSeatOf = (plan, studentId) => {
    for (let bi = 0; bi < plan.blocks.length; bi++) {
        const seats = plan.blocks[bi].seats;
        for (let si = 0; si < seats.length; si++) {
            if (seats[si].sid != null && String(seats[si].sid) === String(studentId)) {
                return { bi, si };
            }
        }
    }
    return null;
};

// ── Opérations ────────────────────────────────────────────────────────────────

// Ajoute ou retire une rangée / une colonne en gardant les élèves déjà assis
// aux places qui survivent au redimensionnement.
export const resizeBlock = (plan, bi, dRows, dCols) => {
    if (!plan.blocks[bi]) return plan;
    const next = clonePlan(plan);
    const b = next.blocks[bi];
    const nr = Math.max(1, Math.min(MAX_ROWS, b.rows + dRows));
    const nc = Math.max(1, Math.min(MAX_COLS, b.cols + dCols));
    const seats = [];
    for (let r = 0; r < nr; r++) {
        for (let c = 0; c < nc; c++) {
            seats.push(r < b.rows && c < b.cols ? b.seats[r * b.cols + c] : { sid: null, t: 0 });
        }
    }
    b.rows = nr;
    b.cols = nc;
    b.seats = seats;
    return next;
};

// Un banc visé peut avoir disparu entre-temps : rangée retirée, îlot supprimé,
// ou dépôt sur une cible périmée. Toute opération vérifie donc que la référence
// pointe encore sur un banc, et s'abstient plutôt que de casser le plan.
// Une case retirée compte comme absente : on n'y assoit personne.
export const seatExists = (plan, ref) =>
    Boolean(ref && plan.blocks[ref.bi] && plan.blocks[ref.bi].seats[ref.si]
        && !plan.blocks[ref.bi].seats[ref.si].x);

// Échange le contenu de deux bancs (l'étiquette de couleur suit l'élève).
export const swapSeats = (plan, from, to) => {
    if (!seatExists(plan, from) || !seatExists(plan, to)) return plan;
    const next = clonePlan(plan);
    const a = next.blocks[from.bi].seats[from.si];
    next.blocks[from.bi].seats[from.si] = next.blocks[to.bi].seats[to.si];
    next.blocks[to.bi].seats[to.si] = a;
    return next;
};

// Assoit un élève. S'il était déjà assis ailleurs, les deux bancs s'échangent ;
// sinon l'occupant éventuel du banc visé retourne dans la liste à placer.
export const seatStudent = (plan, target, studentId) => {
    if (!seatExists(plan, target)) return plan;
    const origin = findSeatOf(plan, studentId);
    if (origin) {
        if (origin.bi === target.bi && origin.si === target.si) return plan;
        return swapSeats(plan, origin, target);
    }
    const next = clonePlan(plan);
    next.blocks[target.bi].seats[target.si] = { sid: String(studentId), t: 0 };
    return next;
};

export const clearSeat = (plan, target) => {
    if (!seatExists(plan, target)) return plan;
    const next = clonePlan(plan);
    next.blocks[target.bi].seats[target.si] = { sid: null, t: 0 };
    return next;
};

export const clearAllSeats = (plan) => {
    const next = clonePlan(plan);
    next.blocks.forEach(b => b.seats.forEach(s => { s.sid = null; s.t = 0; }));
    return next;
};

// Retire un banc de l'îlot, ou le remet. Son élève éventuel retourne dans la
// liste à placer.
export const toggleSeatRemoved = (plan, ref) => {
    if (!ref || !plan.blocks[ref.bi] || !plan.blocks[ref.bi].seats[ref.si]) return plan;
    const next = clonePlan(plan);
    const removed = next.blocks[ref.bi].seats[ref.si].x;
    next.blocks[ref.bi].seats[ref.si] = removed ? { sid: null, t: 0 } : { sid: null, t: 0, x: true };
    return next;
};

export const cycleTag = (plan, target) => {
    if (!seatExists(plan, target)) return plan;
    const next = clonePlan(plan);
    const seat = next.blocks[target.bi].seats[target.si];
    seat.t = ((seat.t || 0) + 1) % TAG_COUNT;
    return next;
};

const shuffled = (list) => {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
};

// Remplit la salle avec les ids donnés, de gauche à droite en partant de la
// rangée la plus proche du tableau. Renvoie le plan et le nombre d'élèves
// restés debout faute de banc.
export const fillPlan = (plan, studentIds, random) => {
    const queue = random ? shuffled(studentIds) : [...studentIds];
    const next = clearAllSeats(plan);
    let k = 0;
    next.blocks.forEach(b => {
        for (let r = b.rows - 1; r >= 0; r--) {
            for (let c = 0; c < b.cols; c++) {
                if (k >= queue.length) return;
                if (b.seats[r * b.cols + c].x) continue;
                b.seats[r * b.cols + c] = { sid: String(queue[k++]), t: 0 };
            }
        }
    });
    return { plan: next, left: queue.length - k };
};
