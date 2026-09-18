// server/src/controllers/ScheduleImportController.js
//
// Import d'un emploi du temps depuis le PDF hebdomadaire de l'ecole.
//
// Deux etapes, pour que rien ne soit ecrit sans validation :
//   POST /schedule/import/preview  - lit le PDF et propose des correspondances
//                                    avec les matieres / classes / creneaux
//                                    deja enregistres. N'ecrit rien.
//   POST /schedule/import/apply    - applique la grille validee par l'utilisateur
//                                    dans une transaction.

const pool = require('../../config/database');
const ScheduleHoursController = require('./ScheduleHoursController');
const { parseSchedulePdf } = require('../utils/schedulePdfParser');

const HOUR_RE = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]-([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
const NEUTRAL_COLOR = '#95a5a6';

const stripAccents = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const norm = (s) => stripAccents(s).toUpperCase().replace(/[^A-Z0-9]/g, '');

// Le PDF colore les cases de la couleur de la matiere, mais les cours sans
// couleur attribuee ressortent en gris tres clair : inutile de la reprendre.
function usableColor(hex) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return null;
    const [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].substr(i, 2), 16));
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max - min < 24) return null;      // gris / noir / blanc
    return `#${m[1].toLowerCase()}`;
}

// Rapprochement souple : le PDF abrege ("INFO." -> "Informatique",
// "3 TIN" -> "3TINF"), la casse et les espaces ne sont pas fiables.
function suggest(raw, candidates) {
    const r = norm(raw);
    if (r.length < 2) return { id: null, name: null, confidence: 'none' };

    const scored = [];
    for (const c of candidates) {
        const n = norm(c.name);
        if (n.length < 2) continue;
        let score;
        if (n === r) score = 100;
        else if (n.startsWith(r)) score = 88 - Math.min(18, n.length - r.length);
        else if (r.startsWith(n)) score = 84 - Math.min(18, r.length - n.length);
        else if (n.includes(r) || r.includes(n)) score = 66;
        else continue;
        scored.push({ id: c.id, name: c.name, score });
    }
    if (!scored.length) return { id: null, name: null, confidence: 'none' };

    scored.sort((a, b) => b.score - a.score);
    const [best, runnerUp] = scored;
    const ambiguous = runnerUp && best.score - runnerUp.score < 8;
    const confidence = best.score === 100 ? 'exact'
        : (best.score >= 80 && !ambiguous) ? 'high'
            : 'low';
    return { id: best.id, name: best.name, confidence };
}

// "3 TIN" -> "3eme". Sert de valeur par defaut si la classe doit etre creee.
function guessLevel(raw, knownLevels) {
    const digit = (/\d/.exec(String(raw || '')) || [])[0];
    if (!digit) return knownLevels[0] || '3ème';
    return knownLevels.find(l => l.startsWith(digit)) || `${digit}ème`;
}

// Le PDF ne porte pas de periode de validite : on propose l'annee scolaire
// qui contient sa date d'edition.
function suggestPeriod(generatedAt) {
    const d = generatedAt ? new Date(generatedAt) : new Date();
    const ref = isNaN(d.getTime()) ? new Date() : d;
    const startYear = ref.getMonth() >= 6 ? ref.getFullYear() : ref.getFullYear() - 1;
    return {
        name: `Horaire ${startYear}-${startYear + 1}`,
        start_date: `${startYear}-09-01`,
        end_date: `${startYear + 1}-06-30`
    };
}

async function assertJournalOwned(conn, journalId, userId) {
    const [rows] = await conn.execute(
        'SELECT id, school_id FROM JOURNALS WHERE id = ? AND user_id = ?',
        [journalId, userId]
    );
    if (!rows.length) {
        const err = new Error("Journal de classe introuvable ou acces refuse.");
        err.status = 404;
        throw err;
    }
    // L'ecole du journal commande la grille horaire a utiliser : deux
    // etablissements peuvent decouper la journee differemment.
    return rows[0];
}

class ScheduleImportController {

    // --- Etape 1 : lecture du PDF, aucune ecriture -------------------------
    static async preview(req, res) {
        const userId = req.user.id;
        const journalId = parseInt(req.body.journal_id, 10);

        if (!req.file || !req.file.buffer) {
            return res.status(400).json({ success: false, message: 'Aucun fichier PDF recu.' });
        }
        if (!journalId) {
            return res.status(400).json({ success: false, message: "L'ID du journal est requis." });
        }
        if (req.file.buffer.slice(0, 5).toString('latin1') !== '%PDF-') {
            return res.status(400).json({ success: false, message: "Ce fichier n'est pas un PDF." });
        }

        let parsed;
        try {
            parsed = parseSchedulePdf(req.file.buffer);
        } catch (error) {
            return res.status(422).json({ success: false, message: `PDF illisible : ${error.message}` });
        }

        try {
            const journal = await assertJournalOwned(pool, journalId, userId);

            const { hours } = await ScheduleHoursController.resolveForSchool(pool, journal.school_id);
            const [subjects] = await pool.execute(
                'SELECT id, name, color_code FROM SUBJECTS WHERE user_id = ?', [userId]
            );
            const [classes] = await pool.execute(
                'SELECT id, name, level FROM CLASSES WHERE journal_id = ?', [journalId]
            );

            const hourByLibelle = new Map(hours.map(h => [h.libelle, h.id]));
            const knownLevels = [...new Set(classes.map(c => c.level).filter(Boolean))].sort();

            const usedLibelles = [...new Set(parsed.slots.map(s => s.libelle))];
            const periods = parsed.periods.map(p => ({
                libelle: p.libelle,
                hour_id: hourByLibelle.get(p.libelle) || null,
                used: usedLibelles.includes(p.libelle)
            }));

            const colorOf = new Map();
            for (const s of parsed.slots) {
                if (!colorOf.has(s.subject)) colorOf.set(s.subject, usableColor(s.color));
            }

            const subjectRaws = [...new Set(parsed.slots.map(s => s.subject).filter(Boolean))];
            const classRaws = [...new Set(parsed.slots.map(s => s.className).filter(Boolean))];

            res.json({
                success: true,
                data: {
                    teacher: parsed.teacher,
                    school: parsed.school,
                    generatedAt: parsed.generatedAt,
                    pageCount: parsed.pageCount,
                    days: parsed.days,
                    periods,
                    subjects: subjectRaws.map(raw => ({
                        raw,
                        color: colorOf.get(raw) || NEUTRAL_COLOR,
                        ...suggest(raw, subjects)
                    })),
                    classes: classRaws.map(raw => ({
                        raw,
                        level: guessLevel(raw, knownLevels),
                        ...suggest(raw, classes)
                    })),
                    slots: parsed.slots.map(s => ({
                        day: s.day,
                        dayLabel: s.dayLabel,
                        libelle: s.libelle,
                        subject: s.subject,
                        className: s.className,
                        room: s.room
                    })),
                    suggestion: suggestPeriod(parsed.generatedAt),
                    warnings: parsed.warnings
                }
            });
        } catch (error) {
            const status = error.status || 500;
            res.status(status).json({ success: false, message: error.message });
        }
    }

    // --- Etape 2 : ecriture de la grille validee ---------------------------
    static async apply(req, res) {
        const userId = req.user.id;
        const {
            journal_id, mode, set_id, name, start_date, end_date,
            subjectMap = {}, classMap = {}, slots = []
        } = req.body;

        const journalId = parseInt(journal_id, 10);
        if (!journalId) {
            return res.status(400).json({ success: false, message: "L'ID du journal est requis." });
        }
        if (!Array.isArray(slots) || slots.length === 0) {
            return res.status(400).json({ success: false, message: 'Aucun cours a importer.' });
        }
        if (mode === 'replace' && !set_id) {
            return res.status(400).json({ success: false, message: "Aucun horaire cible selectionne." });
        }
        if (mode !== 'replace' && (!name || !start_date || !end_date)) {
            return res.status(400).json({ success: false, message: 'Nom et dates de validite requis.' });
        }

        const badHour = slots.find(s => !HOUR_RE.test(String(s.libelle || '')));
        if (badHour) {
            return res.status(400).json({ success: false, message: `Creneau horaire invalide : ${badHour.libelle}` });
        }
        const badDay = slots.find(s => !(parseInt(s.day, 10) >= 1 && parseInt(s.day, 10) <= 7));
        if (badDay) {
            return res.status(400).json({ success: false, message: 'Jour de la semaine invalide.' });
        }

        let connection;
        try {
            connection = await pool.getConnection();
            await connection.beginTransaction();
            const journal = await assertJournalOwned(connection, journalId, userId);

            const created = { hours: [], subjects: [], classes: [] };

            // 1. Creneaux horaires : ceux de l'ecole du journal (sa grille
            // propre, ou la grille commune si elle n'en a pas). Un creneau
            // manquant est cree la ou l'ecole lit, pour que l'import n'aille
            // pas nourrir la grille d'un autre etablissement.
            const { hours, isOwn } = await ScheduleHoursController.resolveForSchool(connection, journal.school_id);
            const hoursOwner = isOwn ? journal.school_id : null;
            const hourByLibelle = new Map(hours.map(h => [h.libelle, h.id]));
            for (const libelle of new Set(slots.map(s => s.libelle))) {
                if (hourByLibelle.has(libelle)) continue;
                const [r] = await connection.execute('INSERT INTO SCH_HOURS (libelle, school_id) VALUES (?, ?)', [libelle, hoursOwner]);
                hourByLibelle.set(libelle, r.insertId);
                created.hours.push(libelle);
            }

            // 2. Matieres : lien vers l'existant, ou creation.
            const subjectIds = new Map();
            for (const [raw, choice] of Object.entries(subjectMap)) {
                if (!choice || choice.action === 'ignore') continue;
                if (choice.action === 'link') {
                    const [rows] = await connection.execute(
                        'SELECT id FROM SUBJECTS WHERE id = ? AND user_id = ?', [choice.id, userId]
                    );
                    if (!rows.length) throw Object.assign(new Error(`Matiere inconnue pour "${raw}".`), { status: 400 });
                    subjectIds.set(raw, rows[0].id);
                } else if (choice.action === 'create') {
                    const label = String(choice.name || raw).trim();
                    if (!label) throw Object.assign(new Error('Nom de matiere vide.'), { status: 400 });
                    const [r] = await connection.execute(
                        'INSERT INTO SUBJECTS (user_id, name, color_code) VALUES (?, ?, ?)',
                        [userId, label, usableColor(choice.color_code) || NEUTRAL_COLOR]
                    );
                    subjectIds.set(raw, r.insertId);
                    created.subjects.push(label);
                }
            }

            // 3. Classes : idem, dans le journal courant.
            const classIds = new Map();
            for (const [raw, choice] of Object.entries(classMap)) {
                if (!choice || choice.action === 'ignore') continue;
                if (choice.action === 'link') {
                    const [rows] = await connection.execute(
                        'SELECT id FROM CLASSES WHERE id = ? AND journal_id = ?', [choice.id, journalId]
                    );
                    if (!rows.length) throw Object.assign(new Error(`Classe inconnue pour "${raw}".`), { status: 400 });
                    classIds.set(raw, rows[0].id);
                } else if (choice.action === 'create') {
                    const label = String(choice.name || raw).trim();
                    const level = String(choice.level || '').trim();
                    if (!label || !level) {
                        throw Object.assign(new Error(`Nom ou niveau manquant pour la classe "${raw}".`), { status: 400 });
                    }
                    const [dup] = await connection.execute(
                        'SELECT id FROM CLASSES WHERE LOWER(name) = LOWER(?) AND journal_id = ?', [label, journalId]
                    );
                    if (dup.length) {
                        classIds.set(raw, dup[0].id);
                    } else {
                        const [r] = await connection.execute(
                            'INSERT INTO CLASSES (journal_id, name, level) VALUES (?, ?, ?)',
                            [journalId, label, level]
                        );
                        classIds.set(raw, r.insertId);
                        created.classes.push(label);
                    }
                }
            }

            // 4. Modele cible : nouveau, ou remplacement d'un modele existant.
            let setId;
            if (mode === 'replace') {
                const [sets] = await connection.execute(
                    'SELECT id FROM SCHEDULE_SETS WHERE id = ? AND user_id = ?', [set_id, userId]
                );
                if (!sets.length) throw Object.assign(new Error('Horaire cible introuvable.'), { status: 404 });
                setId = sets[0].id;
                if (name && start_date && end_date) {
                    await connection.execute(
                        'UPDATE SCHEDULE_SETS SET name = ?, start_time = ?, end_time = ? WHERE id = ?',
                        [name, start_date, end_date, setId]
                    );
                }
            } else {
                const [r] = await connection.execute(
                    'INSERT INTO SCHEDULE_SETS (user_id, journal_id, name, start_time, end_time) VALUES (?, ?, ?, ?, ?)',
                    [userId, journalId, name, start_date, end_date]
                );
                setId = r.insertId;
            }

            // 5. Creneaux : on repart d'une grille vide, comme saveSlots.
            await connection.execute('DELETE FROM SCHEDULE_SLOTS WHERE schedule_set_id = ?', [setId]);

            const seen = new Set();
            const values = [];
            for (const s of slots) {
                const key = `${s.day}|${s.libelle}`;
                if (seen.has(key)) continue;
                seen.add(key);
                const subjectId = subjectIds.get(s.subject) || null;
                const classId = classIds.get(s.className) || null;
                const room = String(s.room || '').trim().slice(0, 50);
                if (!subjectId && !classId && !room) continue;
                values.push([setId, parseInt(s.day, 10), hourByLibelle.get(s.libelle), classId, subjectId, room]);
            }

            if (values.length) {
                await connection.query(
                    'INSERT INTO SCHEDULE_SLOTS (schedule_set_id, day_of_week, time_slot_id, class_id, subject_id, room) VALUES ?',
                    [values]
                );
            }

            await connection.commit();
            res.status(mode === 'replace' ? 200 : 201).json({
                success: true,
                data: { set_id: setId, slots: values.length, created },
                message: `${values.length} cours importes.`
            });

        } catch (error) {
            if (connection) await connection.rollback();
            console.error('Erreur import horaire PDF:', error);
            res.status(error.status || 500).json({ success: false, message: error.message });
        } finally {
            if (connection) connection.release();
        }
    }
}

module.exports = ScheduleImportController;
