// server/src/routes/PlanRoute.js
const express = require('express');
const router = express.Router();
const PlanController = require('../controllers/PlanController');

// Disposition de la salle d'une classe (îlots, bancs, élèves assis)
router.get('/:classId', PlanController.getPlan);
router.put('/:classId', PlanController.savePlan);

module.exports = router;
