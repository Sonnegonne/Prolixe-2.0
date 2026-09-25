// client/src/utils/scheduleBands.js
//
// Lignes de la grille horaire : une par créneau réellement occupé.
//
// Deux écoles n'ont pas le même découpage (« 08:25-09:15 » d'un côté,
// « 08:30-09:20 » de l'autre). Une ligne par libellé doublait donc chaque
// heure de cours et laissait une ligne vide sur deux. Ici on ne garde que les
// libellés qui portent au moins un cours dans la semaine, puis on regroupe
// ceux qui se recouvrent en une seule bande.

// « 8:30 » comme « 08:30 » : on compare des minutes, jamais du texte.
const toMinutes = (hhmm) => {
    const [h, m] = String(hhmm || '').split(':');
    const minutes = Number(h) * 60 + Number(m);
    return Number.isFinite(minutes) ? minutes : null;
};
const startMinutes = (libelle) => toMinutes(String(libelle || '').split('-')[0]) ?? Number.MAX_SAFE_INTEGER;
const endMinutes = (libelle) => toMinutes(String(libelle || '').split('-')[1]);

const pad = (n) => String(n).padStart(2, '0');
export const formatMinutes = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

// Deux créneaux vont sur la même ligne s'ils se recouvrent sur au moins la
// moitié du plus court : 08:25-09:15 et 08:30-09:20 oui, 09:15-10:05 et
// 10:00-10:50 non (cinq minutes de chevauchement ne font pas la même heure).
const sameBand = (a, b) => {
    const overlap = Math.min(a.end, b.end) - Math.max(a.start, b.start);
    const shortest = Math.min(a.end - a.start, b.end - b.start);
    return overlap > 0 && overlap * 2 >= shortest;
};

/**
 * @param {string[]} libelles libellés portant au moins un cours
 * @returns {{ key, start, end, libelles: string[] }[]} bandes triées
 */
export const buildBands = (libelles) => {
    const intervals = [...new Set(libelles)]
        .map(libelle => {
            const start = startMinutes(libelle);
            const end = endMinutes(libelle) ?? start + 50;
            return { libelle, start, end };
        })
        .sort((a, b) => a.start - b.start || a.end - b.end);

    const bands = [];
    for (const interval of intervals) {
        const last = bands[bands.length - 1];
        if (last && last.members.some(member => sameBand(member, interval))) {
            last.members.push(interval);
            last.end = Math.max(last.end, interval.end);
        } else {
            bands.push({ start: interval.start, end: interval.end, members: [interval] });
        }
    }

    return bands.map(band => ({
        key: band.members.map(m => m.libelle).join('|'),
        start: band.start,
        end: band.end,
        libelles: band.members.map(m => m.libelle),
    }));
};
