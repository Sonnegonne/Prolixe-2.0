// server/src/services/smartschoolJournal.js
//
// Construction du journal de classe tel qu'il doit apparaître dans l'actualité
// Smartschool du cours : un tableau DATE / TYPE / DESCRIPTION, tenu à jour.
//
// Volontairement sans accès à la base : ce module ne reçoit que des lignes
// brutes et rend des lignes propres, du HTML et une empreinte. C'est la partie
// qui mérite d'être testée, et elle l'est (server/tests/smartschoolJournal.test.js).

const crypto = require('crypto');

// Marqueurs posés par le journal dans content_done
// (cf. getStatusFromActualWork, client/src/components/journal/Journal.js:95).
const STATUS_MARKERS = {
    '[CANCELLED]': 'cancelled',
    '[HOLIDAY]': 'holiday',
    '[EXAM]': 'exam',
};

const TRAVAIL_EN_CLASSE = 'TRAVAIL EN CLASSE';

/** '2026-09-10T00:00:00.000Z' ou un Date -> '2026-09-10' */
const toDateKey = (value) => {
    if (!value) return '';
    if (value instanceof Date) {
        const p = (n) => String(n).padStart(2, '0');
        return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
    }
    return String(value).split('T')[0];
};

/** '2026-09-10' -> '10/09' */
const toShortDate = (dateKey) => {
    const [, m, d] = (dateKey || '').split('-');
    return m && d ? `${d}/${m}` : dateKey || '';
};

/**
 * Lit un « travail effectué » : marqueurs techniques retirés, lignes vides
 * écrasées. Rend aussi le statut et le drapeau interro trouvés dans le texte.
 */
const readDoneWork = (raw) => {
    let text = (raw || '').trim();
    let status = 'given';

    for (const [marker, value] of Object.entries(STATUS_MARKERS)) {
        if (text.startsWith(marker)) {
            status = value;
            text = text.slice(marker.length).trim();
        }
    }

    let isInterro = false;
    if (text.startsWith('[INTERRO]')) {
        isInterro = true;
        text = text.slice('[INTERRO]'.length).trim();
    }

    // Les tags d'assignation vivent normalement dans le travail prévu, mais on
    // ne prend aucun risque : rien de technique ne doit atteindre les élèves.
    text = text.replace(/\[EVAL#\d+\]\s*/g, '');

    // Les retours à la ligne sont conservés : ils portent du sens dans le
    // tableau (« Rappel du chapitre 1. » puis « Chapitres 2 et 3. »), et
    // l'actualité déjà en ligne les affiche ainsi.
    const description = text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join('\n');

    return { description, status, isInterro };
};

// Ce que Prolixe appelle « Devoir », l'établissement l'appelle « Prépa ».
// Le renommage vit ici, au seul endroit qui parle aux élèves : le journal, lui,
// garde ses propres mots, et rien dans la base n'est réécrit.
// « Devoir coté » est un autre type : il garde son nom.
const TYPES_PUBLIES = { DEVOIR: 'PRÉPA' };
const DEVOIR_COTE = 'DEVOIR COTÉ';

/** 'Interro' -> 'INTERRO', 'Devoir' -> 'PRÉPA', 'Devoir coté' -> 'DEVOIR COTÉ' */
const typeLabel = (type) => {
    const brut = (type || 'Évaluation').trim().toUpperCase();
    return TYPES_PUBLIES[brut] || brut;
};

const cleanDescription = (raw) => (raw || '')
    .replace(/\[EVAL#\d+\]\s*/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');

/**
 * Assemble les lignes publiables d'un cours.
 *
 * @param {Array} entries     lignes JOURNAL_ENTRIES du cours
 *                            ({ entry_date, content_done, exclude_from_smartschool })
 * @param {Array} assignments lignes ASSIGNMENTS du cours
 *                            ({ due_date, type, description, exclude_from_smartschool })
 * @returns {Array<{date: string, type: string, description: string}>} triées par date
 */
function buildRows(entries = [], assignments = []) {
    const rows = [];

    // 1. Les assignations d'abord : elles font autorité sur leur date.
    //    (Une interro cochée dans le journal crée l'assignation ET tague le
    //    travail effectué ; sans cette priorité, la ligne sortirait deux fois.)
    const interroRowByDate = new Map();

    for (const a of assignments) {
        if (a.exclude_from_smartschool) continue;
        const date = toDateKey(a.due_date);
        if (!date) continue;

        // La matière d'une interro ou d'une prépa vit dans `subject`, pas dans
        // `description` — que l'enseignante laisse presque toujours vide. Ne
        // lire que `description` produisait des cellules vides pour les lignes
        // qui comptent le plus. Les deux sont joints quand les deux existent.
        const detail = [cleanDescription(a.subject), cleanDescription(a.description)]
            .filter(Boolean)
            .join(' — ');

        const row = { date, type: typeLabel(a.type), description: detail };
        rows.push(row);
        if (row.type === 'INTERRO' && !interroRowByDate.has(date)) interroRowByDate.set(date, row);
    }

    // 2. Puis le travail effectué.
    for (const e of entries) {
        if (e.exclude_from_smartschool) continue;
        const date = toDateKey(e.entry_date);
        if (!date) continue;

        const { description, status, isInterro } = readDoneWork(e.content_done);

        // Un cours annulé ou un congé n'a rien à dire aux élèves.
        if (status === 'cancelled' || status === 'holiday') continue;

        if (status === 'exam') {
            rows.push({ date, type: 'EXAMEN', description });
            continue;
        }

        // Jour d'interro : l'assignation porte déjà la ligne, on ne la double
        // pas. La matière qu'elle nomme fait autorité — c'est le champ que
        // l'enseignante remplit exprès. Le texte du journal ne sert que de
        // secours, quand l'assignation ne dit rien du tout.
        if (isInterro && interroRowByDate.has(date)) {
            const ligne = interroRowByDate.get(date);
            if (!ligne.description && description) ligne.description = description;
            continue;
        }

        if (!description) continue;
        rows.push({ date, type: isInterro ? 'INTERRO' : TRAVAIL_EN_CLASSE, description });
    }

    // 3. Deux heures de cours le même jour produisent souvent le même texte.
    const seen = new Set();
    const unique = rows.filter((r) => {
        const key = `${r.date}|${r.type}|${r.description.toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    unique.sort((a, b) => (
        a.date === b.date ? a.type.localeCompare(b.type, 'fr') : a.date.localeCompare(b.date)
    ));
    return unique;
}

const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Échappe, puis rend les retours à la ligne — seule balise tolérée ici. */
const multiline = (value) => escapeHtml(value).split('\n').join('<br>');

const stampOf = (date) => toDateKey(date).split('-').reverse().join('/');

// Mise en forme relevée sur l'actualité « Journal de classe » déjà en ligne
// (cours 3TTI, 13 septembre 2026) : fond jaune porté par le tableau lui-même,
// lignes roses pour ce qui est coté, cellules toutes en <th> centrées et grasses.
// On la reproduit telle quelle — l'actualité ne doit pas changer d'allure le
// jour où elle se met à jour toute seule.
const TABLE_BG = 'rgb(251, 238, 184)';   // jaune
const GRADED_BG = 'rgb(248, 202, 198)';  // rose
const DEVOIR_COTE_BG = 'rgb(221, 200, 240)';  // mauve
const COL_WIDTHS = ['33.4663%', '23.8235%', '42.6837%'];

// Ce qui est coté prend la ligne rose. Tout le reste garde le fond du tableau.
const GRADED_TYPES = new Set(['INTERRO', 'ÉVALUATION', 'EVALUATION', 'EXAMEN', 'CONTRÔLE', 'CONTROLE']);
const isGraded = (type) => GRADED_TYPES.has(String(type || '').toUpperCase());

// Un devoir coté a sa propre couleur, pour ne pas le confondre avec une interro.
const rowBackground = (type) => {
    if (String(type || '').toUpperCase() === DEVOIR_COTE) return DEVOIR_COTE_BG;
    return isGraded(type) ? GRADED_BG : null;
};

/**
 * Rend le tableau en HTML. Styles en ligne uniquement : l'éditeur de
 * Smartschool ne transporte aucune feuille de style à nous.
 */
function renderHtml(rows, { updatedAt = new Date() } = {}) {
    if (!rows.length) {
        return '<p><em>Aucune activité encodée pour le moment.</em></p>';
    }

    const cell = (extra = '') => `style="text-align: center;${extra}"`;

    const header = `
    <tr>
      <th ${cell()}><strong>DATE</strong></th>
      <th ${cell()}><strong>TYPE</strong></th>
      <th ${cell()}><strong>DESCRIPTION</strong></th>
    </tr>`;

    const body = rows.map((r) => {
        const bg = rowBackground(r.type);
        const rowStyle = bg ? ` style="background-color: ${bg};"` : '';
        return `
    <tr${rowStyle}>
      <th ${cell()}><strong>${escapeHtml(toShortDate(r.date))}</strong></th>
      <th ${cell()}><strong>${escapeHtml(r.type)}</strong></th>
      <th ${cell()}><strong>${multiline(r.description)}</strong></th>
    </tr>`;
    }).join('');

    const cols = COL_WIDTHS.map((w) => `<col style="width: ${w};">`).join('');

    return `<table style="border-collapse: collapse; width: 99.046%; border-width: 1px; background-color: ${TABLE_BG};" border="1">
  <colgroup>${cols}</colgroup>
  <tbody>${header}${body}
  </tbody>
</table>
<p style="font-size: 12px; color: rgb(107, 114, 128);">Mis à jour automatiquement depuis le journal de classe — ${escapeHtml(stampOf(updatedAt))}</p>`;
}

/** Repli si l'éditeur Smartschool refuse le HTML : même tableau, en texte. */
function renderText(rows, { updatedAt = new Date() } = {}) {
    if (!rows.length) return 'Aucune activité encodée pour le moment.';

    // Le repli reste tabulaire : une entrée par ligne, quoi qu'elle contienne.
    const lines = rows.map((r) => (
        `${toShortDate(r.date)}\t${r.type}\t${r.description.split('\n').join(' — ')}`
    ));
    return [
        'DATE\tTYPE\tDESCRIPTION',
        ...lines,
        '',
        `Mis à jour automatiquement depuis le journal de classe — ${stampOf(updatedAt)}`,
    ].join('\n');
}

/**
 * Empreinte du contenu publiable. C'est elle, et non un horodatage, qui décide
 * s'il faut réécrire l'actualité : réenregistrer une entrée sans la modifier ne
 * doit rien repousser vers Smartschool.
 */
function contentHash(title, rows) {
    return crypto
        .createHash('sha256')
        .update(JSON.stringify({ title, rows }))
        .digest('hex');
}

// =========================================================
// --- NOTIFICATION : seulement pour une prépa, un devoir coté ou une interro ajoutés ---
// =========================================================

// Les notifications sont coupées par défaut : le journal change presque tous
// les jours, et une notification quotidienne par cours ferait couper les
// notifications par toute la classe. Deux choses méritent pourtant d'atteindre
// les élèves : une interro, une prépa ou un devoir coté qui apparaît. Rien
// d'autre — ni une correction de texte, ni un projet, ni le travail effectué.
const TYPES_NOTIFIES = new Set(['INTERRO', 'DEVOIR', DEVOIR_COTE]);

/** Identifiants (texte) des assignations dont l'apparition doit prévenir les élèves. */
function notifiableKeys(assignments = []) {
    return assignments
        .filter((a) => !a.exclude_from_smartschool && a.id != null && toDateKey(a.due_date))
        .filter((a) => TYPES_NOTIFIES.has(String(a.type || '').trim().toUpperCase()))
        .map((a) => String(a.id))
        .sort();
}

/**
 * Ce qui est nouveau depuis la dernière publication.
 *
 * `published` à `null` veut dire : on ne sait pas ce qui a été publié (liaison
 * antérieure à cette règle). Dans le doute, personne n'est prévenu — tout
 * annoncer comme « nouveau » enverrait une notification pour chaque interro de
 * l'année au premier passage.
 */
function newKeys(current = [], published = null) {
    if (!Array.isArray(published)) return [];
    const deja = new Set(published.map(String));
    return current.filter((k) => !deja.has(String(k)));
}

/** Lit la colonne `published_assignments` sans jamais planter sur un contenu abîmé. */
function parseKeys(raw) {
    if (raw === null || raw === undefined || raw === '') return null;
    try {
        const valeur = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return Array.isArray(valeur) ? valeur.map(String) : null;
    } catch {
        return null;
    }
}

// =========================================================
// --- RAPPEL D'INTERRO OU DE DEVOIR COTÉ : une actualité à part, de J-2 à J ---
// =========================================================

/** Types d'assignation (tels que Prolixe les enregistre) qui ont un rappel. */
const REMINDER_TYPES = ['Interro', 'Devoir coté'];

/** Jours avant l'interro où le rappel apparaît (48 h). */
const REMINDER_DAYS_BEFORE = 2;

const TIMEZONE = 'Europe/Brussels';

/** Date du jour à Waremme, et non celle du serveur (le VPS vit en UTC). */
const todayKey = (now = new Date()) => new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(now);

/** '2026-09-26' + (-2) -> '2026-09-24', sans passer par une heure locale. */
const addDays = (dateKey, days) => {
    const [y, m, d] = dateKey.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

/** Fenêtre de visibilité du rappel : de J-2 au jour J inclus. */
function reminderWindow(dueDate) {
    const till = toDateKey(dueDate);
    return { from: till ? addDays(till, -REMINDER_DAYS_BEFORE) : '', till };
}

/** Le rappel doit-il être visible aujourd'hui ? */
function isInReminderWindow(dueDate, today = todayKey()) {
    const { from, till } = reminderWindow(dueDate);
    return Boolean(till) && today >= from && today <= till;
}

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/** '2026-09-26' -> 'samedi 26/09' */
const longDate = (dateKey) => {
    const [y, m, d] = dateKey.split('-').map(Number);
    const jour = JOURS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
    return `${jour} ${toShortDate(dateKey)}`;
};

// Ce qui change d'un rappel à l'autre. L'interro garde mot pour mot son
// rappel d'origine : son empreinte ne bouge pas, rien n'est republié.
const REMINDER_STYLES = {
    INTERRO: {
        titre: 'Interro',
        intitule: 'Interrogation',
        defaut: 'pense à revoir la matière avant l\'interro.',
        bg: GRADED_BG,
    },
    [DEVOIR_COTE]: {
        titre: 'Devoir coté',
        intitule: 'Devoir coté',
        defaut: 'pense à terminer ton devoir et à le remettre à temps.',
        bg: DEVOIR_COTE_BG,
    },
};

/**
 * Contenu de l'actualité de rappel d'une interro ou d'un devoir coté.
 *
 * Le nom de l'interro est la matière de l'assignation (`subject`, « HDW 1 »),
 * comme dans le tableau du journal ; la description, quand il y en a une,
 * précise le rappel.
 *
 * @returns {{title, html, visibleFrom, visibleTill, hash}}
 */
function buildReminder(assignment) {
    const dueDate = toDateKey(assignment.due_date);
    const nom = cleanDescription(assignment.subject).split('\n').join(' — ');
    const detail = cleanDescription(assignment.description);
    const quand = longDate(dueDate);
    const { from, till } = reminderWindow(dueDate);
    const style = REMINDER_STYLES[typeLabel(assignment.type)] || REMINDER_STYLES.INTERRO;

    const title = `${style.titre}${nom ? ` — ${nom}` : ''} — ${quand}`;

    const lignes = [
        `<p><strong>${style.intitule}${nom ? ` : ${escapeHtml(nom)}` : ''}</strong></p>`,
        `<p><strong>Date :</strong> ${escapeHtml(quand)}</p>`,
        `<p><strong>Rappel :</strong> ${detail
            ? multiline(detail)
            : style.defaut}</p>`,
    ];

    // Même couleur que la ligne du tableau du journal : rose pour une interro,
    // mauve pour un devoir coté — les élèves les reconnaissent à leur couleur.
    const html = `<table style="border-collapse: collapse; width: 99.046%; border-width: 1px; background-color: ${style.bg};" border="1">
  <tbody>
    <tr>
      <td style="padding: 8px;">
      ${lignes.join('\n      ')}
      </td>
    </tr>
  </tbody>
</table>`;

    const hash = crypto
        .createHash('sha256')
        .update(JSON.stringify({ title, html, from, till, visible: true }))
        .digest('hex');

    return { title, html, visibleFrom: from, visibleTill: till, hash };
}

/** Empreinte d'un rappel retiré : il suffit qu'elle diffère de celle d'un rappel visible. */
const hiddenHash = (title, html) => crypto
    .createHash('sha256')
    .update(JSON.stringify({ title, html, visible: false }))
    .digest('hex');

module.exports = {
    buildRows,
    renderHtml,
    renderText,
    contentHash,
    toDateKey,
    toShortDate,
    readDoneWork,
    notifiableKeys,
    newKeys,
    parseKeys,
    todayKey,
    reminderWindow,
    isInReminderWindow,
    buildReminder,
    hiddenHash,
    REMINDER_TYPES,
};
