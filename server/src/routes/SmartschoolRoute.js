// server/src/routes/SmartschoolRoute.js
const express = require('express');
const router = express.Router();
const SmartschoolController = require('../controllers/SmartschoolController');

// Les cours du journal — classe × matière — avec leur liaison
router.get('/courses',            SmartschoolController.getCourses);

// Liaison cours Prolixe <-> cours Smartschool (courseID + ssID)
router.get('/targets',            SmartschoolController.getTargets);
router.put('/targets',            SmartschoolController.upsertTarget);
router.delete('/targets/:id',     SmartschoolController.deleteTarget);

// Aperçu de ce qui partira pour un cours
router.get('/targets/:id/preview', SmartschoolController.preview);

// File de publication, consommée par l'extension Chrome
router.get('/pending',            SmartschoolController.pending);
router.post('/published',         SmartschoolController.markPublished);
router.post('/failed',            SmartschoolController.markFailed);

// Rappels d'interro : une actualité par interro, visible de J-2 à J
router.get('/reminders/pending',    SmartschoolController.pendingReminders);
router.post('/reminders/published', SmartschoolController.markReminderPublished);
router.post('/reminders/failed',    SmartschoolController.markReminderFailed);

// Retirer une entrée ou une assignation du contenu publié
router.post('/exclusion',         SmartschoolController.setExclusion);

module.exports = router;
