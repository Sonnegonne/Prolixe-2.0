const db = require('../../config/database');

exports.getEvaluations = async (req, res) => {
    const { journalId } = req.query;
    const user_id = req.user.id;

    if (!journalId) return res.status(400).json({ message: "L'ID du journal est requis." });

    try {
        const [evaluations] = await db.query(`
            SELECT e.*, c.name as class_name, s.name as subject_name
            FROM EVALUATIONS e
                     JOIN CLASSES c ON e.class_id = c.id
                     JOIN JOURNALS j ON e.journal_id = j.id
                     LEFT JOIN SUBJECTS s ON e.subject_id = s.id
            WHERE e.journal_id = ? AND j.user_id = ?
            ORDER BY e.evaluation_date DESC
        `, [journalId, user_id]);

        res.json({ success: true, data: evaluations });
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur", error: error.message });
    }
};

/**
 * Récupère une évaluation spécifique avec ses critères triés.
 */
exports.getEvaluationById = async (req, res) => {
    const { id } = req.params;
    const user_id = req.user.id;

    try {
        const [evaluationResult] = await db.query(`
            SELECT e.*, c.name as class_name 
            FROM EVALUATIONS e
            JOIN JOURNALS j ON e.journal_id = j.id
            JOIN CLASSES c ON e.class_id = c.id
            WHERE e.id = ? AND j.user_id = ?
        `, [id, user_id]);

        if (evaluationResult.length === 0) {
            return res.status(404).json({ success: false, message: "Évaluation non trouvée." });
        }

        const evaluation = evaluationResult[0];

        const [criteria] = await db.query(`
            SELECT * FROM EVALUATION_CRITERIA 
            WHERE evaluation_id = ? 
            ORDER BY display_order ASC
        `, [id]);

        res.json({ success: true, data: { ...evaluation, criteria } });
    } catch (error) {
        res.status(500).json({ success: false, message: "Erreur serveur" });
    }
};

exports.createEvaluation = async (req, res) => {
    const { title, class_id, journal_id, subject_id, journal_entry_id, evaluation_date, max_score, global_comment, criteria, folder } = req.body;
    const user_id = req.user.id;
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();
        const [result] = await connection.query(
            `INSERT INTO EVALUATIONS (title, class_id, journal_id, subject_id, journal_entry_id, evaluation_date, max_score, global_comment, folder)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [title, class_id, journal_id, subject_id, journal_entry_id, evaluation_date, max_score || 20, global_comment, folder]
        );
        const evaluationId = result.insertId;

        if (criteria && Array.isArray(criteria)) {
            for (let i = 0; i < criteria.length; i++) {
                const c = criteria[i];
                await connection.query(
                    `INSERT INTO EVALUATION_CRITERIA (evaluation_id, name, section_name, description, max_points, display_order) 
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [evaluationId, c.name, c.section_name || 'Général', c.description || null, c.max_points, i]
                );
            }
        }
        await connection.commit();
        res.status(201).json({ success: true, id: evaluationId });
    } catch (error) {
        await connection.rollback();
        res.status(500).json({ success: false, error: error.message });
    } finally { connection.release(); }
};

exports.updateEvaluation = async (req, res) => {
    const { id } = req.params;
    const { title, evaluation_date, max_score, criteria, folder } = req.body;
    const user_id = req.user.id;
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();
        await connection.query(`
            UPDATE EVALUATIONS e JOIN JOURNALS j ON e.journal_id = j.id
            SET e.title = ?, e.evaluation_date = ?, e.max_score = ?, e.folder = ?
            WHERE e.id = ? AND j.user_id = ?
        `, [title, evaluation_date, max_score, folder, id, user_id]);

        if (criteria && Array.isArray(criteria)) {
            const currentIds = criteria.filter(c => c.id).map(c => c.id);
            if (currentIds.length > 0) {
                await connection.query(`DELETE FROM EVALUATION_CRITERIA WHERE evaluation_id = ? AND id NOT IN (?)`, [id, currentIds]);
            } else {
                await connection.query(`DELETE FROM EVALUATION_CRITERIA WHERE evaluation_id = ?`, [id]);
            }

            for (let i = 0; i < criteria.length; i++) {
                const c = criteria[i];
                if (c.id) {
                    await connection.query(
                        `UPDATE EVALUATION_CRITERIA SET name = ?, section_name = ?, max_points = ?, display_order = ? 
                         WHERE id = ? AND evaluation_id = ?`,
                        [c.name, c.section_name || 'Général', c.max_points, i, c.id, id]
                    );
                } else {
                    await connection.query(
                        `INSERT INTO EVALUATION_CRITERIA (evaluation_id, name, section_name, max_points, display_order) 
                         VALUES (?, ?, ?, ?, ?)`,
                        [id, c.name, c.section_name || 'Général', c.max_points, i]
                    );
                }
            }
        }
        await connection.commit();
        res.json({ success: true });
    } catch (error) {
        await connection.rollback();
        res.status(500).json({ success: false, error: error.message });
    } finally { connection.release(); }
};

exports.getEvaluationForGrading = async (req, res) => {
    const { id } = req.params;
    const user_id = req.user.id;
    try {
        const [evals] = await db.query(`
            SELECT e.*, c.name as class_name FROM EVALUATIONS e 
            JOIN JOURNALS j ON e.journal_id = j.id JOIN CLASSES c ON e.class_id = c.id
            WHERE e.id = ? AND j.user_id = ?`, [id, user_id]);
        if (evals.length === 0) return res.status(404).json({ message: "Introuvable" });

        const evaluation = evals[0];
        const [students] = await db.query('SELECT id, firstname, lastname FROM STUDENTS WHERE class_id = ? ORDER BY lastname, firstname', [evaluation.class_id]);
        const [criteria] = await db.query('SELECT * FROM EVALUATION_CRITERIA WHERE evaluation_id = ? ORDER BY display_order ASC', [id]);
        const [grades] = await db.query('SELECT * FROM STUDENT_GRADES WHERE evaluation_id = ?', [id]);
        const [criteriaGrades] = await db.query(`
            SELECT scg.* FROM STUDENT_CRITERIA_GRADES scg
            JOIN EVALUATION_CRITERIA ec ON scg.criterion_id = ec.id WHERE ec.evaluation_id = ?`, [id]);

        res.json({ success: true, data: { evaluation, students, criteria, grades, criteriaGrades } });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
};

exports.saveDetailedGrades = async (req, res) => {
    const { evaluationId } = req.params;
    const { studentGrades, is_corrected, is_completed } = req.body;
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        for (const sg of studentGrades) {
            await connection.query(`
                INSERT INTO STUDENT_GRADES (evaluation_id, student_id, score, is_absent)
                VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE score = VALUES(score), is_absent = VALUES(is_absent)`,
                [evaluationId, sg.student_id, sg.total_score, sg.is_absent || false]);

            if (sg.criteria_scores) {
                for (const cs of sg.criteria_scores) {
                    await connection.query(`
                        INSERT INTO STUDENT_CRITERIA_GRADES (student_id, criterion_id, score_obtained, comment)
                        VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE score_obtained = VALUES(score_obtained), comment = VALUES(comment)`,
                        [sg.student_id, cs.criterion_id, cs.score, cs.comment || null]);
                }
            }
        }
        await connection.query(`UPDATE EVALUATIONS SET is_completed = ?, is_corrected = ? WHERE id = ?`, [is_completed, is_corrected, evaluationId]);
        await connection.commit();
        res.json({ success: true });
    } catch (error) { await connection.rollback(); res.status(500).json({ error: error.message }); }
    finally { connection.release(); }
};

exports.deleteEvaluation = async (req, res) => {
    const { id } = req.params;
    const user_id = req.user.id;
    try {
        await db.query(`DELETE e FROM EVALUATIONS e JOIN JOURNALS j ON e.journal_id = j.id WHERE e.id = ? AND j.user_id = ?`, [id, user_id]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
};

exports.getEvaluationTemplates = async (req, res) => {
    const user_id = req.user.id;
    try {
        const [templates] = await db.query(`SELECT e.id, e.title, e.max_score, j.name as journal_name FROM EVALUATIONS e JOIN JOURNALS j ON e.journal_id = j.id WHERE j.user_id = ?`, [user_id]);
        res.json({ success: true, data: templates });
    } catch (error) { res.status(500).json({ success: false }); }
};