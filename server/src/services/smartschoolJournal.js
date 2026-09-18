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
const TYPES_PUBLIES = { DEVOIR: 'PRÉPA' };

/** 'Interro' -> 'INTERRO', 'Devoir' -> 'PRÉPA' */
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
const COL_WIDTHS = ['33.4663%', '23.8235%', '42.6837%'];

// Ce qui est coté prend la ligne rose. Tout le reste garde le fond du tableau.
const GRADED_TYPES = new Set(['INTERRO', 'ÉVALUATION', 'EVALUATION', 'EXAMEN', 'CONTRÔLE', 'CONTROLE']);
const isGraded = (type) => GRADED_TYPES.has(String(type || '').toUpperCase());

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
        const rowStyle = isGraded(r.type) ? ` style="background-color: ${GRADED_BG};"` : '';
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

module.exports = {
    buildRows,
    renderHtml,
    renderText,
    contentHash,
    toDateKey,
    toShortDate,
    readDoneWork,
};
