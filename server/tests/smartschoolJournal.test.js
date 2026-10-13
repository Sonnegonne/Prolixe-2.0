// Bancs d'essai du constructeur de journal Smartschool.
// Sans dépendance : `node tests/smartschoolJournal.test.js` depuis server/.

const assert = require('assert');
const {
    buildRows, renderHtml, renderText, contentHash, readDoneWork, toShortDate,
    notifiableKeys, newKeys, parseKeys, todayKey,
    reminderWindow, isInReminderWindow, buildReminder, hiddenHash,
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

// --- Notification : seulement une interro ou une prépa ajoutée ------------

const aNotifier = [
    { id: 1, type: 'Interro', due_date: '2026-09-26', subject: 'HDW 1' },
    { id: 2, type: 'Devoir', due_date: '2026-09-25', subject: 'Prépa HD 2' },
    { id: 3, type: 'Projet', due_date: '2026-10-10', subject: 'Site web' },
    { id: 4, type: 'Interro', due_date: '2026-09-30', exclude_from_smartschool: 1 },
];

test('seules les interros et prépas publiées comptent pour notifier', () => {
    assert.deepStrictEqual(notifiableKeys(aNotifier), ['1', '2']);
});

test('une interro ajoutée est nouvelle', () => {
    assert.deepStrictEqual(newKeys(['1', '2', '5'], ['1', '2']), ['5']);
});

test('une retouche sans ajout ne notifie pas', () => {
    assert.deepStrictEqual(newKeys(['1', '2'], ['1', '2']), []);
    assert.deepStrictEqual(newKeys(['1'], ['1', '2']), []);   // suppression
});

test('publication antérieure inconnue : personne n\'est prévenu', () => {
    assert.deepStrictEqual(newKeys(['1', '2'], null), []);
});

test('la colonne abîmée ne plante pas', () => {
    assert.strictEqual(parseKeys(null), null);
    assert.strictEqual(parseKeys('pas du json'), null);
    assert.deepStrictEqual(parseKeys('[1,"2"]'), ['1', '2']);
    assert.deepStrictEqual(parseKeys('[]'), []);
});

// --- Rappel d'interro : actualité séparée, de J-2 à J ----------------------

test('la fenêtre du rappel va de J-2 au jour J', () => {
    assert.deepStrictEqual(reminderWindow('2026-09-26'), { from: '2026-09-24', till: '2026-09-26' });
    // passage de mois
    assert.deepStrictEqual(reminderWindow('2026-10-01'), { from: '2026-09-29', till: '2026-10-01' });
});

test('le rappel n\'existe qu\'entre J-2 et J', () => {
    assert.strictEqual(isInReminderWindow('2026-09-26', '2026-09-23'), false);
    assert.strictEqual(isInReminderWindow('2026-09-26', '2026-09-24'), true);
    assert.strictEqual(isInReminderWindow('2026-09-26', '2026-09-26'), true);
    assert.strictEqual(isInReminderWindow('2026-09-26', '2026-09-27'), false);
    assert.strictEqual(isInReminderWindow(null, '2026-09-26'), false);
});

test('la date du jour est celle de Bruxelles, pas celle du serveur', () => {
    // 23 h 30 UTC le 24 = 1 h 30 le 25 à Waremme (heure d'été)
    assert.strictEqual(todayKey(new Date('2026-09-24T23:30:00Z')), '2026-09-25');
});

test('le rappel nomme l\'interro, sa date et le rappel', () => {
    const r = buildReminder({ id: 1, due_date: '2026-09-26', subject: 'HDW 1', description: 'Chapitre 2 <cartes mères>' });
    assert.strictEqual(r.title, 'Interro — HDW 1 — samedi 26/09');
    assert.ok(r.html.includes('HDW 1'));
    assert.ok(r.html.includes('samedi 26/09'));
    assert.ok(r.html.includes('Rappel'));
    assert.ok(r.html.includes('&lt;cartes mères&gt;'), 'le texte est échappé');
    assert.strictEqual(r.visibleFrom, '2026-09-24');
    assert.strictEqual(r.visibleTill, '2026-09-26');
});

test('sans description, le rappel reste lisible', () => {
    const r = buildReminder({ id: 1, due_date: '2026-09-28', subject: '', description: '' });
    assert.strictEqual(r.title, 'Interro — lundi 28/09');
    assert.ok(r.html.includes('revoir la matière'));
});

test('l\'empreinte du rappel suit son contenu, et le retrait en diffère', () => {
    const a = buildReminder({ id: 1, due_date: '2026-09-26', subject: 'HDW 1' });
    const b = buildReminder({ id: 1, due_date: '2026-09-26', subject: 'HDW 1' });
    const c = buildReminder({ id: 1, due_date: '2026-09-27', subject: 'HDW 1' });
    assert.strictEqual(a.hash, b.hash);
    assert.notStrictEqual(a.hash, c.hash);
    assert.notStrictEqual(a.hash, hiddenHash(a.title, a.html));
});

console.log(`\n${passed} essais passés${process.exitCode ? ' — avec des échecs' : ''}`);
