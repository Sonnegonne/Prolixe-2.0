// backend/routes/journalRoutes.js
const express = require('express');
const router = express.Router();
const JournalController = require('../controllers/JournalController');
const multer = require('multer');

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

router.get('/', JournalController.getAllJournals);
router.post('/', JournalController.createJournal);
router.post('/archive/:id', JournalController.archiveJournal);
router.delete('/delete/:id', JournalController.deleteJournal);
router.delete('/entries/clear/:journal_id', JournalController.clearJournal);


router.post('/archive/:id', JournalController.archiveJournal);
router.post('/import', upload.single('journalFile'), JournalController.importJournal);
router.get('/current', JournalController.getCurrentJournal);
//router.get('/archived', JournalController.getArchivedJournals);



// Routes pour les entrées de journal
router.get('/entries', JournalController.getJournalEntries);
router.put('/entries', JournalController.upsertJournalEntry); // Upsert (créer/mettre à jour)
//router.delete('/entries/:id', JournalController.deleteJournalEntry);


// Routes pour les assignations (interros/devoirs)
/*
router.get('/assignments', JournalController.getAssignments);
router.put('/assignments', JournalController.upsertAssignment); // Upsert
router.delete('/assignments/:id', JournalController.deleteAssignment);*/

module.exports = router;
