// server/src/routes/ScheduleRoute.js
const express = require('express');
const path = require('path');
const multer = require('multer');
const router = express.Router();
const ScheduleController = require('../controllers/ScheduleController');
const ScheduleImportController = require('../controllers/ScheduleImportController');

// Import PDF : le fichier reste en memoire, il est lu puis jete.
const uploadPdf = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (path.extname(file.originalname || '').toLowerCase() !== '.pdf') {
            return cb(new Error('Seuls les fichiers .pdf sont acceptes.'));
        }
        cb(null, true);
    }
});

router.get('/sets', ScheduleController.getJournalSchedules);
router.post('/sets', ScheduleController.createScheduleSet);


router.post('/slots/save', ScheduleController.saveSlots);

// Import depuis le PDF de l'ecole : lecture seule, puis ecriture validee.
router.post('/import/preview', (req, res, next) => {
    uploadPdf.single('schedulePdf')(req, res, (err) => {
        if (err) return res.status(400).json({ success: false, message: err.message });
        next();
    });
}, ScheduleImportController.preview);

router.post('/import/apply', ScheduleImportController.apply);

router.post('/sets/:id/duplicate', ScheduleController.duplicateScheduleSet);
router.delete('/sets/:id', ScheduleController.deleteScheduleSet);
router.put('/sets/:id', ScheduleController.updateScheduleSet); // Route pour modifier le nom/dates
router.delete('/sets/:setId/slots/:day/:hourId', ScheduleController.deleteSlot); // Route pour supprimer un cours

router.get('/active-set', ScheduleController.getScheduleByDate);

// Vue toutes ecoles d'une date. A declarer avant '/:id', qui avalerait le mot.
router.get('/overview', ScheduleController.getOverview);

router.get('/:id', (req, res, next) => {
    next();
}, ScheduleController.getFullSchedule);

module.exports = router;