const pool = require('../../config/database');
const SchoolController = require('./SchoolController');

// L'ecole d'une attribution etait une chaine libre. Elle peut desormais
// designer un etablissement enregistre : dans ce cas le libelle n'est plus
// saisi, il est recopie depuis l'ecole pour qu'une seule source fasse foi.
// Une attribution sans school_id reste valide (saisie libre, ancien import).
async function resolveSchool(userId, body) {
    const schoolId = parseInt(body.school_id, 10);
    if (Number.isFinite(schoolId) && schoolId > 0) {
        const school = await SchoolController.assertOwned(pool, schoolId, userId);
        return { schoolId: school.id, schoolName: school.name };
    }
    return { schoolId: null, schoolName: body.school_name ?? null };
}

class AttributionController {

    static async getAttributions(req, res) {

        const userId = req.user.id;
        try {
            // Les colonnes de SCHOOL_YEARS sont aliasées : sans alias elles écrasent
            // a.start_date / a.end_date (clés dupliquées) et le client reçoit les dates
            // de l'année scolaire au lieu de celles de l'attribution.
            const [rows] = await pool.execute(`
                SELECT a.*, sy.start_date AS school_year_start, sy.end_date AS school_year_end,
                       sc.color AS school_color, sc.short_name AS school_short_name
                FROM ATTRIBUTIONS a
                JOIN SCHOOL_YEARS sy ON a.school_year_id = sy.id
                LEFT JOIN SCHOOLS sc ON sc.id = a.school_id
                WHERE a.user_id = ?
            `, [userId]);
            res.json({ success: true, data: rows });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    static async createAttribution(req, res) {
        const userId = req.user.id;
        const { school_year_id, start_date, end_date, className, esi_hours, ess_hours } = req.body;

        try {
            const { schoolId, schoolName } = await resolveSchool(userId, req.body);
            const [result] = await pool.execute(
                `INSERT INTO ATTRIBUTIONS
                 (school_year_id, user_id, start_date, end_date, school_id, school_name, class, esi_hours, ess_hours)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    school_year_id,   // school_year_id
                    userId,           // user_id
                    start_date,       // start_date
                    end_date,         // end_date
                    schoolId,         // school_id
                    schoolName,       // school_name
                    className,        // class
                    esi_hours ?? 0,   // esi_hours (utilise ?? pour accepter la valeur 0)
                    ess_hours ?? 0    // ess_hours
                ]
            );

            res.status(201).json({ success: true, id: result.insertId });
        } catch (error) {
            console.error("Erreur lors de la création de l'attribution :", error.message);
            res.status(500).json({ success: false, message: "Erreur interne du serveur" });
        }
    }

    static async updateAttribution(req, res) {
        const { id } = req.params;
        const userId = req.user.id;
        const { school_year_id, start_date, end_date, className, esi_hours, ess_hours } = req.body;

        try {
            const { schoolId, schoolName } = await resolveSchool(userId, req.body);
            // Vérifie l'appartenance avant la mise à jour : affectedRows d'un UPDATE
            // vaut 0 quand les valeurs sont identiques, ce qui donnerait un faux 404.
            const [existing] = await pool.execute(
                'SELECT id FROM ATTRIBUTIONS WHERE id = ? AND user_id = ?',
                [id, userId]
            );

            if (existing.length === 0) {
                return res.status(404).json({ success: false, message: "Attribution non trouvée ou non autorisée." });
            }

            await pool.execute(
                `UPDATE ATTRIBUTIONS
                 SET school_year_id = ?, start_date = ?, end_date = ?, school_id = ?, school_name = ?, class = ?, esi_hours = ?, ess_hours = ?
                 WHERE id = ? AND user_id = ?`,
                [
                    school_year_id,     // school_year_id
                    start_date,         // start_date
                    end_date,           // end_date
                    schoolId,           // school_id
                    schoolName,         // school_name
                    className ?? null,  // class (colonne nullable)
                    esi_hours ?? 0,     // esi_hours
                    ess_hours ?? 0,     // ess_hours
                    id,
                    userId
                ]
            );

            res.json({ success: true, id: Number(id), message: "Attribution mise à jour avec succès." });
        } catch (error) {
            console.error("Erreur lors de la mise à jour de l'attribution :", error.message);
            res.status(500).json({ success: false, message: "Erreur interne du serveur" });
        }
    }

    static async deleteAttribution(req, res) {
        const { id } = req.params;
        const userId = req.user.id;
        try {
            const [result] = await pool.execute(
                'DELETE FROM ATTRIBUTIONS WHERE id = ? AND user_id = ?',
                [id, userId]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({ success: false, message: "Attribution non trouvée ou non autorisée." });
            }

            res.json({ success: true, message: "Attribution supprimée avec succès." });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }
}
module.exports = AttributionController;
