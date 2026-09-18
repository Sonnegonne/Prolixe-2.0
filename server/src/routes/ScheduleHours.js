// backend/routes/ScheduleHours.js
//
// `isAdmin` a disparu de ces routes : l'autorisation depend desormais de la
// grille visee, pas seulement du role. Une enseignante gere librement les
// creneaux de ses propres ecoles ; la grille commune reste administrable par
// un ADMIN seul. Le controleur tranche (voir #assertWritable).
const express = require('express');
const router = express.Router();
const ScheduleHoursController = require('../controllers/ScheduleHoursController');

router.get('/', ScheduleHoursController.getAllHours);
router.post('/detach', ScheduleHoursController.detach);
router.get('/:id', ScheduleHoursController.getHourById);

router.post('/', ScheduleHoursController.createHour);
router.put('/:id', ScheduleHoursController.updateHour);
router.delete('/:id', ScheduleHoursController.deleteHour);

module.exports = router;
