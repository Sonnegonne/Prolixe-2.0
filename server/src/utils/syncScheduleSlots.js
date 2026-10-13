// Remplace la grille d'un horaire par `slots` en gardant l'id des creneaux
// qui restent en place (meme jour, meme heure).
//
// L'ancienne methode -- tout supprimer puis tout reinserer -- donnait de
// nouveaux id a chaque enregistrement. Or JOURNAL_ENTRIES et ASSIGNMENTS
// pointent vers SCHEDULE_SLOTS en ON DELETE SET NULL : reenregistrer un
// horaire, meme sans rien y changer, detachait donc toutes ses lecons et
// ses interros, qui disparaissaient du journal (septembre 2026 : trois
// semaines de JDC « effacees »). Seul un creneau reellement retire de la
// grille est encore supprime.
//
// slots : [{ day_of_week, time_slot_id, class_id, subject_id, room }]
// A appeler dans une transaction ouverte sur `connection`.
async function syncScheduleSlots(connection, scheduleSetId, slots) {
    const keyOf = (day, hour) => `${Number(day)}|${Number(hour)}`;

    const [existing] = await connection.execute(
        'SELECT id, day_of_week, time_slot_id FROM SCHEDULE_SLOTS WHERE schedule_set_id = ? ORDER BY id',
        [scheduleSetId]
    );
    const existingByKey = new Map();
    const toDelete = [];
    for (const row of existing) {
        const key = keyOf(row.day_of_week, row.time_slot_id);
        if (existingByKey.has(key)) toDelete.push(row.id); // doublon d'une ancienne grille
        else existingByKey.set(key, row.id);
    }

    const kept = new Set();
    const inserts = [];
    for (const s of slots || []) {
        const key = keyOf(s.day_of_week, s.time_slot_id);
        if (kept.has(key)) continue;
        kept.add(key);
        const values = [s.class_id || null, s.subject_id || null, s.room || null];
        const id = existingByKey.get(key);
        if (id) {
            await connection.execute(
                'UPDATE SCHEDULE_SLOTS SET class_id = ?, subject_id = ?, room = ? WHERE id = ?',
                [...values, id]
            );
        } else {
            inserts.push([scheduleSetId, s.day_of_week, s.time_slot_id, ...values]);
        }
    }

    for (const [key, id] of existingByKey) {
        if (!kept.has(key)) toDelete.push(id);
    }
    if (toDelete.length) {
        await connection.query('DELETE FROM SCHEDULE_SLOTS WHERE id IN (?)', [toDelete]);
    }
    if (inserts.length) {
        await connection.query(
            'INSERT INTO SCHEDULE_SLOTS (schedule_set_id, day_of_week, time_slot_id, class_id, subject_id, room) VALUES ?',
            [inserts]
        );
    }
    return { updated: kept.size - inserts.length, inserted: inserts.length, deleted: toDelete.length };
}

module.exports = { syncScheduleSlots };
