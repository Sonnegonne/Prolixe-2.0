// server/src/routes/ScheduleRoute.js
const express = require('express');
const router = express.Router();
const ScheduleController = require('../controllers/ScheduleController');

router.get('/sets', ScheduleController.getJournalSchedules);
router.post('/sets', ScheduleController.createScheduleSet);


router.post('/slots/save', ScheduleController.saveSlots);

router.post('/sets/:id/duplicate', ScheduleController.duplicateScheduleSet);
router.delete('/sets/:id', ScheduleController.deleteScheduleSet);
router.put('/sets/:id', ScheduleController.updateScheduleSet); // Route pour modifier le nom/dates
router.delete('/sets/:setId/slots/:day/:hourId', ScheduleController.deleteSlot); // Route pour supprimer un cours

router.get('/active-set', ScheduleController.getScheduleByDate);

router.get('/:id', (req, res, next) => {
    next();
}, ScheduleController.getFullSchedule);

module.exports = router;