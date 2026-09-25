// server/src/routes/NoteRoute.js

const express = require('express');
const router = express.Router();
const NoteController = require('../controllers/NoteController');

router.get('/', NoteController.getNotes);
// Rendez-vous du jour, toutes écoles confondues (tableau de bord).
router.get('/agenda', NoteController.getAgenda);
router.post('/', NoteController.createNote);
router.put('/:id', NoteController.updateNote);
router.delete('/:id', NoteController.deleteNote);
module.exports = router;