// server/src/server.js
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const PDFDocument = require('pdfkit');
require('dotenv').config();

// Initialisation Express
const app = express();
const PORT = process.env.PORT || 5000;

// ==========================================
// 1. MIDDLEWARES GLOBAUX
// ==========================================
app.use(cors());
// Indispensable pour parser le JSON et éviter l'erreur "req.body is undefined"
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==========================================
// 2. CONFIGURATION & POOL BASE DE DONNÉES
// ==========================================
const dbConfig = {
    host: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT) || 3306,
    database: process.env.DB_DATABASE,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
    connectionLimit: 10,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
};

let pool;

async function initDatabase() {
    try {
        console.log('🔄 Connexion à MySQL...');
        pool = mysql.createPool(dbConfig);

        // Test de connexion
        const connection = await pool.getConnection();
        console.log('✅ Base de données connectée.');

        // Vérification Table USER (Exemple de migration simple)
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS USER (
                id INT AUTO_INCREMENT PRIMARY KEY,
                email VARCHAR(255) NOT NULL UNIQUE,
                password VARCHAR(255) NOT NULL,
                role ENUM('ADMIN', 'USER') NOT NULL DEFAULT 'USER',
                firstname VARCHAR(255),
                name VARCHAR(255)
            )
        `);
        connection.release();
    } catch (error) {
        console.error('❌ Erreur Critique DB:', error);
        process.exit(1);
    }
}

// Injection du pool dans les requêtes
app.use((req, res, next) => {
    req.pool = pool;
    next();
});

// ==========================================
// 3. ARCHITECTURE DES ROUTES
// ==========================================

// Import des middlewares
const verifyToken = require('./middleware/authMiddleware');

// --- Routes Publiques ---
app.use('/api/auth', require('./routes/AuthRoute'));

// --- Routeur API Protégé ---
const apiRouter = express.Router();

// Applique le token à TOUTES les routes qui suivent sous /api/...
apiRouter.use(verifyToken);

// Enregistrement des ressources protégées
apiRouter.use('/users', require('./routes/UserRoute'));
apiRouter.use('/classes', require('./routes/ClassRoutes'));
apiRouter.use('/hours', require('./routes/ScheduleHours'));
apiRouter.use('/schedule', require('./routes/ScheduleRoute'));
apiRouter.use('/journal', require('./routes/JournalRoute'));
apiRouter.use('/attributions', require('./routes/AttributionRoute'));
apiRouter.use('/evaluations', require('./routes/EvaluationRoute'));
apiRouter.use('/students', require('./routes/StudentRoute'));
apiRouter.use('/conseilDeClasse', require('./routes/ConseilRoutes'));
apiRouter.use('/notes', require('./routes/NoteRoute'));
apiRouter.use('/school-years', require('./routes/SchoolYearRoute'));
apiRouter.use('/holidays', require('./routes/HolidayRoute'));
apiRouter.use('/subjects', require('./routes/SubjectsRoute'));

// Attachement du routeur centralisé
app.use('/api', apiRouter);

// ==========================================
// 4. GÉNÉRATION PDF (Logique isolée)
// ==========================================
app.post('/api/generate-document', verifyToken, (req, res) => {
    const { text, orientation = 'portrait' } = req.body;
    if (!text) return res.status(400).json({ error: 'Texte manquant' });

    try {
        const doc = new PDFDocument({ layout: orientation, size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="document.pdf"');

        doc.pipe(res);
        // ... (Logique de ton PDF ici, simplifiée pour la lisibilité)
        doc.fontSize(25).text('Document Prolixe', { align: 'center' });
        doc.moveDown().fontSize(12).text(text);
        doc.end();
    } catch (err) {
        res.status(500).send('Erreur génération PDF');
    }
});

// ==========================================
// 5. GESTION DES ERREURS & DÉMARRAGE
// ==========================================

// Route de diagnostic
app.get('/api/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'OK', database: 'Connected' });
    } catch (e) {
        res.status(500).json({ status: 'Error', database: 'Disconnected' });
    }
});

// Middleware d'erreur global
app.use((err, req, res, next) => {
    console.error('💥 Error Stack:', err.stack);
    res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Erreur Serveur Interne'
    });
});

async function startServer() {
    await initDatabase();
    app.listen(PORT, () => {
        console.log(`🚀 Serveur actif sur http://localhost:${PORT}`);
    });
}

// Fermeture propre
process.on('SIGINT', async () => {
    if (pool) await pool.end();
    process.exit(0);
});

startServer();