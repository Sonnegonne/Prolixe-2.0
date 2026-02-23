// server/src/routes/ScheduleRoute.js
const express = require('express');
const router = express.Router();
const ScheduleController = require('../controllers/ScheduleController');

router.get('/sets', ScheduleController.getJournalSchedules);
router.post('/sets', ScheduleController.createScheduleSet);


router.post('/slots/save', ScheduleController.saveSlots);

router.post('/sets/:id/duplicate', ScheduleController.duplicateScheduleSet);
router.delete('/sets/:id', ScheduleController.deleteScheduleSet);

router.get('/active-set', ScheduleController.getScheduleByDate); // À placer AVANT router.get('/:id')

router.get('/:id', (req, res, next) => {
    console.log('>>> Route /:id atteinte, id =', req.params.id);
    next();
}, ScheduleController.getFullSchedule);

module.exports = router;