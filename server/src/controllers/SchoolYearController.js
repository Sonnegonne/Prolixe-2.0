// backend/controllers/schoolYearController.js
const pool = require('../../config/database');

class SchoolYearController {

    /**
     * Gère les erreurs de manière centralisée pour ce contrôleur.
     * @param {*} res La réponse HTTP
     * @param {*} error L'objet d'erreur
     * @param {string} defaultMessage Message par défaut en cas d'erreur
     * @param {number} statusCode Code de statut HTTP
     */
    static handleError(res, error, defaultMessage = 'Erreur serveur', statusCode = 500) {
        console.error(`❌ Erreur dans SchoolYearController: ${defaultMessage}`, error);
        const errorMessage = process.env.NODE_ENV === 'development' ? error.message : defaultMessage;
        res.status(statusCode).json({ success: false, message: defaultMessage, error: errorMessage });
    }

    /**
     * Récupère toutes les années scolaires.
     * GET /api/school-years
     */
    static async getAllSchoolYears(req, res) {
        try {
            const [rows] = await pool.execute(
                'SELECT id, start_date, end_date, holidays FROM SCHOOL_YEARS ORDER BY start_date ASC'
            );
            res.json({ success: true, data: rows });
        } catch (error) {
            SchoolYearController.handleError(res, error, 'Erreur lors de la récupération des années scolaires.');
        }
    }

    /**
     * Crée une nouvelle année scolaire.
     * POST /api/school-years
     */
    static async createSchoolYear(req, res) {
        const { name, start_date, end_date } = req.body;
        if (!name || !start_date || !end_date) {
            return SchoolYearController.handleError(res, new Error('Champs manquants'), 'Le nom, la date de début et la date de fin sont requis.', 400);
        }

        try {
            const [result] = await pool.execute(
                'INSERT INTO SCHOOL_YEARS (start_date, end_date) VALUES (?, ?, ?)',
                [name, start_date, end_date]
            );
            const newSchoolYearId = result.insertId;
            const [newSchoolYear] = await pool.execute('SELECT * FROM SCHOOL_YEARS WHERE id = ?', [newSchoolYearId]);

            res.status(201).json({ success: true, message: 'Année scolaire créée avec succès.', data: newSchoolYear[0] });
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') {
                return SchoolYearController.handleError(res, error, 'Une année scolaire avec ce nom existe déjà.', 409);
            }
            SchoolYearController.handleError(res, error, 'Erreur lors de la création de l\'année scolaire.');
        }
    }

    /**
     * Met à jour une année scolaire existante.
     * PUT /api/school-years/:id
     */
    static async updateSchoolYear(req, res) {
        const { id } = req.params;
        const { name, start_date, end_date } = req.body;

        if (!name || !start_date || !end_date) {
            return SchoolYearController.handleError(res, new Error('Champs manquants'), 'Le nom, la date de début et la date de fin sont requis.', 400);
        }

        try {
            const [result] = await pool.execute(
                'UPDATE SCHOOL_YEARS SET start_date = ?, end_date = ? WHERE id = ?',
                [name, start_date, end_date, id]
            );

            if (result.affectedRows === 0) {
                return SchoolYearController.handleError(res, new Error('Année non trouvée'), 'Année scolaire non trouvée.', 404);
            }

            const [updatedSchoolYear] = await pool.execute('SELECT * FROM SCHOOL_YEARS WHERE id = ?', [id]);
            res.json({ success: true, message: 'Année scolaire mise à jour.', data: updatedSchoolYear[0] });
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') {
                return SchoolYearController.handleError(res, error, 'Une année scolaire avec ce nom existe déjà.', 409);
            }
            SchoolYearController.handleError(res, error, 'Erreur lors de la mise à jour de l\'année scolaire.');
        }
    }

    /**
     * Supprime une année scolaire.
     * DELETE /api/school-years/:id
     */
    static async deleteSchoolYear(req, res) {
        const { id } = req.params;

        try {
            // Avant de supprimer, on vérifie si l'année est utilisée quelque part.
            // Exemple avec la table JOURNAL. Répétez pour les autres tables (CLASS, STUDENTS, etc.)
            const [journals] = await pool.execute('SELECT id FROM JOURNAL WHERE school_year_id = ?', [id]);
            if (journals.length > 0) {
                return SchoolYearController.handleError(res, new Error('Année utilisée'), 'Impossible de supprimer : cette année scolaire est utilisée par au moins un journal.', 409);
            }
            // Ajoutez ici d'autres vérifications pour les classes, élèves, etc.

            const [result] = await pool.execute('DELETE FROM SCHOOL_YEARS WHERE id = ?', [id]);

            if (result.affectedRows === 0) {
                return SchoolYearController.handleError(res, new Error('Année non trouvée'), 'Année scolaire non trouvée.', 404);
            }

            res.json({ success: true, message: 'Année scolaire supprimée avec succès.' });
        } catch (error) {
            SchoolYearController.handleError(res, error, 'Erreur lors de la suppression de l\'année scolaire.');
        }
    }

    static async getSchoolYearById(req, res){
        const { id } = req.params;
        try {
            const [result] = await pool.execute('SELECT * FROM SCHOOL_YEARS WHERE id = ?', [id]);

            if (result.affectedRows === 0) {
                return SchoolYearController.handleError(res, new Error('Année non trouvée'), 'Année scolaire non trouvée.', 404);
            }

            res.json({ success: true, data: result[0] });
        } catch (error) {
            SchoolYearController.handleError(res, error, 'Erreur lors de la suppression de l\'année scolaire.');
        }
    }
}

module.exports = SchoolYearController;
