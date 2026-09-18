// server/src/routes/SchoolRoute.js
const express = require('express');
const router = express.Router();
const SchoolController = require('../controllers/SchoolController');

router.get('/', SchoolController.list);
router.post('/', SchoolController.create);
router.put('/:id', SchoolController.update);
router.delete('/:id', SchoolController.remove);

module.exports = router;
