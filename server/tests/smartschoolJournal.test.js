// Bancs d'essai du constructeur de journal Smartschool.
// Sans dépendance : `node tests/smartschoolJournal.test.js` depuis server/.

const assert = require('assert');
const {
    buildRows, renderHtml, renderText, contentHash, readDoneWork, toShortDate,
} = require('../src/services/smartschoolJournal');

let passed = 0;
const test = (name, fn) => {
    try {
        fn();
        passed += 1;
        console.log(`  ok   ${name}`);
    } catch (error) {
        console.error(`  FAIL ${name}\n       ${error.message}`);
        process.exitCode = 1;
    }
};

console.log('smartschoolJournal');

// --- Lecture du travail effectué -------------------------------------------

test('retire le marqueur de statut', () => {
    assert.deepStrictEqual(readDoneWork('[CANCELLED]').status, 'cancelled');
    assert.deepStrictEqual(readDoneWork('[HOLIDAY]').status, 'holiday');
    assert.deepStrictEqual(readDoneWork('Cours normal').status, 'given');
});

test('repère et retire le tag interro', () => {
    const { isInterro, description } = readDoneWork('[INTERRO] Hardware chapitre 1');
    assert.strictEqual(isInterro, true);
    assert.strictEqual(description, 'Hardware chapitre 1');
});

test('aucun tag technique ne survit', () => {
    const { description } = readDoneWork('[EVAL#12] Chapitre 2');
    assert.strictEqual(description, 'Chapitre 2');
});

test('les retours à la ligne sont conservés, les lignes vides écrasées', () => {
    const { description } = readDoneWork('Rappel hardware chapitre 1.\n\nHardware chapitre 2 et 3.');
    assert.strictEqual(description, 'Rappel hardware chapitre 1.\nHardware chapitre 2 et 3.');
});

test('toShortDate rend jour/mois', () => {
    assert.strictEqual(toShortDate('2026-09-10'), '10/09');
});

// --- Assemblage -------------------------------------------------------------

// Le cas réel : le journal 3TINFO de la rentrée 2026.
const entries = [
    { entry_date: '2026-08-28', content_done: 'Introduction cours hardware' },
    { entry_date: '2026-09-01', content_done: 'Fin chapitre 1 hardware : Carte mère et boitier' },
    { entry_date: '2026-09-09', content_done: 'Rappel hardware chapitre 1.\n\nHardware chapitre 2 et 3.' },
    { entry_date: '2026-09-10', content_done: '[INTERRO] Hardware chapitre 1' },
];
const assignments = [
    { due_date: '2026-09-10', type: 'Interro', description: 'Hardware chapitre 1' },
    { due_date: '2026-09-17', type: 'Interro', description: 'Hardware chapitre 2 et 3' },
];

test('reproduit le tableau attendu, trié par date', () => {
    const rows = buildRows(entries, assignments);
    assert.deepStrictEqual(rows, [
        { date: '2026-08-28', type: 'TRAVAIL EN CLASSE', description: 'Introduction cours hardware' },
        { date: '2026-09-01', type: 'TRAVAIL EN CLASSE', description: 'Fin chapitre 1 hardware : Carte mère et boitier' },
        { date: '2026-09-09', type: 'TRAVAIL EN CLASSE', description: 'Rappel hardware chapitre 1.\nHardware chapitre 2 et 3.' },
        { date: '2026-09-10', type: 'INTERRO', description: 'Hardware chapitre 1' },
        { date: '2026-09-17', type: 'INTERRO', description: 'Hardware chapitre 2 et 3' },
    ]);
});

test('une interro ne sort pas deux fois', () => {
    const rows = buildRows(entries, assignments);
    assert.strictEqual(rows.filter((r) => r.date === '2026-09-10').length, 1);
});

test('un cours annulé ou un congé ne part pas', () => {
    const rows = buildRows([
        { entry_date: '2026-09-02', content_done: '[CANCELLED] Réunion' },
        { entry_date: '2026-09-03', content_done: '[HOLIDAY]' },
    ], []);
    assert.deepStrictEqual(rows, []);
});

test('une entrée vide ne produit pas de ligne', () => {
    assert.deepStrictEqual(buildRows([{ entry_date: '2026-09-02', content_done: '   ' }], []), []);
});

test('exclusion explicite respectée des deux côtés', () => {
    const rows = buildRows(
        [{ entry_date: '2026-09-01', content_done: 'Secret', exclude_from_smartschool: 1 }],
        [{ due_date: '2026-09-17', type: 'Interro', description: 'Caché', exclude_from_smartschool: 1 }],
    );
    assert.deepStrictEqual(rows, []);
});

test('deux heures le même jour ne font qu\'une ligne', () => {
    const rows = buildRows([
        { entry_date: '2026-09-01', content_done: 'Carte mère' },
        { entry_date: '2026-09-01', content_done: 'Carte mère' },
    ], []);
    assert.strictEqual(rows.length, 1);
});

test('les dates au format ISO complet sont acceptées', () => {
    const rows = buildRows([{ entry_date: '2026-09-01T00:00:00.000Z', content_done: 'X' }], []);
    assert.strictEqual(rows[0].date, '2026-09-01');
});

// --- Rendu ------------------------------------------------------------------

test('le HTML échappe ce qui pourrait casser la page', () => {
    const html = renderHtml([{ date: '2026-09-01', type: 'DEVOIR', description: '<script>alert(1)</script>' }]);
    assert.ok(!html.includes('<script>'), 'une balise brute a survécu');
    assert.ok(html.includes('&lt;script&gt;'));
});

test('le HTML porte les trois colonnes et la date courte', () => {
    const html = renderHtml(buildRows(entries, assignments));
    assert.ok(html.includes('<th') && html.includes('DESCRIPTION'));
    assert.ok(html.includes('<strong>10/09</strong>'));
});

test('reprend la mise en forme de l\'actualité existante', () => {
    const html = renderHtml(buildRows(entries, assignments));
    assert.ok(html.includes('background-color: rgb(251, 238, 184)'), 'fond jaune du tableau');
    assert.ok(html.includes('border="1"'), 'bordure');
    assert.ok(html.includes('width: 33.4663%'), 'largeurs de colonnes');
    assert.strictEqual((html.match(/<tr/g) || []).length, 6, 'en-tête + 5 lignes');
});

test('seules les lignes cotées sont roses', () => {
    const html = renderHtml(buildRows(entries, assignments));
    assert.strictEqual((html.match(/rgb\(248, 202, 198\)/g) || []).length, 2, 'les deux interros');

    const devoir = renderHtml([{ date: '2026-09-20', type: 'DEVOIR', description: 'Exercices' }]);
    assert.ok(!devoir.includes('rgb(248, 202, 198)'), 'un devoir n\'est pas coté');

    const examen = renderHtml([{ date: '2026-12-15', type: 'EXAMEN', description: 'Session' }]);
    assert.ok(examen.includes('rgb(248, 202, 198)'), 'un examen l\'est');
});

test('un journal vide le dit, sans tableau', () => {
    assert.ok(renderHtml([]).includes('Aucune activité'));
    assert.ok(renderText([]).includes('Aucune activité'));
});

test('le repli texte garde une entrée par ligne', () => {
    const text = renderText(buildRows(entries, assignments));
    assert.strictEqual(text.split('\n').filter((l) => l.includes('\t')).length, 6); // en-tête + 5
    // Un texte sur deux lignes ne doit pas casser la tabulation.
    assert.ok(text.includes('Rappel hardware chapitre 1. — Hardware chapitre 2 et 3.'));
});

test('un texte sur deux lignes devient un <br>, échappé', () => {
    const html = renderHtml([{ date: '2026-09-09', type: 'TRAVAIL EN CLASSE', description: 'Ligne A\nLigne B' }]);
    assert.ok(html.includes('Ligne A<br>Ligne B'));

    const mechant = renderHtml([{ date: '2026-09-09', type: 'DEVOIR', description: '<b>x</b>\ny' }]);
    assert.ok(mechant.includes('&lt;b&gt;x&lt;/b&gt;<br>y'), 'seul le <br> passe');
});

// --- Empreinte --------------------------------------------------------------

test('même contenu, même empreinte', () => {
    const a = contentHash('Journal', buildRows(entries, assignments));
    const b = contentHash('Journal', buildRows(entries, assignments));
    assert.strictEqual(a, b);
});

test('le titre entre dans l\'empreinte', () => {
    const rows = buildRows(entries, assignments);
    assert.notStrictEqual(contentHash('Journal', rows), contentHash('Autre', rows));
});

test('une entrée modifiée change l\'empreinte', () => {
    // Un travail en classe, et non un jour d'interro : sur ces jours-là c'est la
    // matière de l'assignation qui fait foi, et retoucher le journal n'y change
    // rien — c'est voulu.
    const modified = [
        ...entries.slice(0, 2),
        { entry_date: '2026-09-09', content_done: 'Tout autre contenu' },
        ...entries.slice(3),
    ];
    assert.notStrictEqual(
        contentHash('Journal', buildRows(entries, assignments)),
        contentHash('Journal', buildRows(modified, assignments)),
    );
});

test('la matière d\'une assignation vit dans subject, pas dans description', () => {
    // Cas réel : l'enseignante remplit « Matière » et laisse la description vide.
    // Ne lire que `description` produisait une cellule vide.
    const rows = buildRows([], [
        { due_date: '2026-09-17', type: 'Interro', subject: 'HD 2 et 3', description: '' },
        { due_date: '2026-09-03', type: 'Devoir', subject: 'Word hardware introduction' },
    ]);
    assert.deepStrictEqual(rows, [
        { date: '2026-09-03', type: 'PRÉPA', description: 'Word hardware introduction' },
        { date: '2026-09-17', type: 'INTERRO', description: 'HD 2 et 3' },
    ]);
});

test('matière et description sont jointes quand les deux existent', () => {
    const rows = buildRows([], [
        { due_date: '2026-09-17', type: 'Interro', subject: 'HD 2 et 3', description: 'Chapitres revus en classe' },
    ]);
    assert.strictEqual(rows[0].description, 'HD 2 et 3 — Chapitres revus en classe');
});

test('« Devoir » devient « PRÉPA », et seulement dans Smartschool', () => {
    // Le renommage est un habillage : rien n'est réécrit dans la base, et
    // Prolixe continue de dire « Devoir ».
    assert.strictEqual(buildRows([], [{ due_date: '2026-09-03', type: 'Devoir', subject: 'x' }])[0].type, 'PRÉPA');
    assert.strictEqual(buildRows([], [{ due_date: '2026-09-03', type: 'Interro', subject: 'x' }])[0].type, 'INTERRO');
});

test('une prépa n\'est pas cotée : pas de ligne rose', () => {
    const html = renderHtml(buildRows([], [{ due_date: '2026-09-03', type: 'Devoir', subject: 'x' }]));
    assert.ok(html.includes('PRÉPA'));
    assert.ok(!html.includes('rgb(248, 202, 198)'));
});

test('la matière de l\'assignation prime sur le texte du journal', () => {
    // C'est le champ rempli exprès ; le journal ne sert que de secours.
    const rows = buildRows(
        [{ entry_date: '2026-09-10', content_done: '[INTERRO] notes en vrac' }],
        [{ due_date: '2026-09-10', type: 'Interro', subject: 'HDW 1' }],
    );
    assert.deepStrictEqual(rows, [
        { date: '2026-09-10', type: 'INTERRO', description: 'HDW 1' },
    ]);
});

test('sans matière ni description, le journal sauve la ligne', () => {
    const rows = buildRows(
        [{ entry_date: '2026-09-10', content_done: '[INTERRO] Hardware chapitre 1' }],
        [{ due_date: '2026-09-10', type: 'Interro', subject: '', description: '' }],
    );
    assert.deepStrictEqual(rows, [
        { date: '2026-09-10', type: 'INTERRO', description: 'Hardware chapitre 1' },
    ]);
});

test('une interro et une prépa le même jour restent deux lignes', () => {
    const rows = buildRows(
        [{ entry_date: '2026-09-10', content_done: '[INTERRO] Chapitre 1' }],
        [{ due_date: '2026-09-10', type: 'Devoir', description: 'Exercices p. 12' }],
    );
    assert.strictEqual(rows.length, 2);
    assert.deepStrictEqual(rows.map((r) => r.type).sort(), ['INTERRO', 'PRÉPA']);
});

test('l\'horodatage du rendu n\'entre PAS dans l\'empreinte', () => {
    // Sinon chaque sondage republierait l'actualité sans qu'elle ait changé.
    const rows = buildRows(entries, assignments);
    assert.strictEqual(contentHash('Journal', rows), contentHash('Journal', rows));
    assert.notStrictEqual(
        renderHtml(rows, { updatedAt: new Date('2026-09-13') }),
        renderHtml(rows, { updatedAt: new Date('2026-09-14') }),
    );
});

console.log(`\n${passed} essais passés${process.exitCode ? ' — avec des échecs' : ''}`);
