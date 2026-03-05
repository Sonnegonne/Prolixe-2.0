// client/src/components/Correction/CorrectionList.js
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { getEvaluations, createEvaluation, updateEvaluation, deleteEvaluation, getEvaluationForGrading } from '../../services/EvaluationService';
import { generateEvaluationPDF } from '../../services/exportPDFService';
import EvaluationModal from './EvaluationModal';
import ConfirmModal from '../ConfirmModal';
import { useToast } from '../../hooks/useToast';
import { useJournal } from '../../hooks/useJournal';
import { Pencil, Copy, FileDown, Trash2 } from 'lucide-react';
import './CorrectionList.scss';

const CorrectionList = () => {
    const { currentJournal, loading: loadingJournal } = useJournal();
    const { success, error: showError, info, removeToast } = useToast();

    const [evaluations, setEvaluations] = useState([]);
    const [loadingEvaluations, setLoadingEvaluations] = useState(true);
    const [error, setError] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingEvaluation, setEditingEvaluation] = useState(null);
    const [evaluationToCopy, setEvaluationToCopy] = useState(null);
    const [confirmModal, setConfirmModal] = useState({ isOpen: false, title: '', message: '', onConfirm: null });

    const fetchEvaluations = useCallback(async () => {
        if (!currentJournal?.id) {
            setEvaluations([]);
            setLoadingEvaluations(false);
            return;
        }

        setLoadingEvaluations(true);
        setError('');
        try {
            let response = await getEvaluations(currentJournal.id);
            response = response.data;
            setEvaluations(response.data || []);
        } catch (err) {
            const errorMessage = 'Impossible de charger les évaluations.';
            setError(errorMessage);
            showError(err.message || errorMessage);
        } finally {
            setLoadingEvaluations(false);
        }
    }, [currentJournal, showError]);

    useEffect(() => {
        fetchEvaluations();
    }, [fetchEvaluations]);

    const groupedEvaluations = useMemo(() => {
        const groups = {};
        evaluations.forEach(evalu => {
            const className = evalu.class_name || 'Sans classe';
            const folderName = evalu.folder || 'Sans dossier';
            if (!groups[className]) groups[className] = {};
            if (!groups[className][folderName]) groups[className][folderName] = [];
            groups[className][folderName].push(evalu);
        });

        const sortedGroups = {};
        Object.keys(groups).sort().forEach(className => {
            sortedGroups[className] = {};
            Object.keys(groups[className]).sort().forEach(folderName => {
                sortedGroups[className][folderName] = groups[className][folderName].sort((a, b) =>
                    new Date(b.evaluation_date) - new Date(a.evaluation_date)
                );
            });
        });
        return sortedGroups;
    }, [evaluations]);

    const handleOpenCreateModal = () => {
        setEditingEvaluation(null);
        setEvaluationToCopy(null);
        setIsModalOpen(true);
    };

    const handleOpenCopyModal = async (ev) => {
        try {
            const { data } = await getEvaluationForGrading(ev.id);
            const { evaluation, criteria } = data.data;
            setEditingEvaluation(null);
            setEvaluationToCopy({ ...evaluation, criteria });
            setIsModalOpen(true);
        } catch (err) {
            showError('Impossible de charger les détails de l\'évaluation.');
        }
    };

    // ✅ CORRECTIF : on charge les critères via getEvaluationForGrading avant d'ouvrir le modal
    const handleOpenEditModal = async (ev) => {
        try {
            const { data } = await getEvaluationForGrading(ev.id);
            const { evaluation, criteria } = data.data;
            setEditingEvaluation({ ...evaluation, criteria });
            setEvaluationToCopy(null);
            setIsModalOpen(true);
        } catch (err) {
            showError('Impossible de charger les détails de l\'évaluation.');
        }
    };

    const handleDeleteClick = (ev) => {
        setConfirmModal({
            isOpen: true,
            title: 'Confirmer la suppression',
            message: `Êtes-vous sûr de vouloir supprimer l'évaluation "${ev.name}" ? Cette action est irréversible.`,
            onConfirm: () => performDelete(ev.id),
        });
    };

    const performDelete = async (id) => {
        try {
            await deleteEvaluation(id);
            await fetchEvaluations();
            success('Évaluation supprimée.');
        } catch (err) {
            showError(err.message || 'Erreur de suppression');
        } finally {
            setConfirmModal({ isOpen: false });
        }
    };

    const handleSaveEvaluation = async (evaluationData) => {
        try {
            if (editingEvaluation) {
                await updateEvaluation(editingEvaluation.id, evaluationData);
                success('Évaluation mise à jour !');
            } else {
                await createEvaluation(evaluationData);
                success('Évaluation créée avec succès !');
            }
            await fetchEvaluations();
            setIsModalOpen(false);
        } catch (err) {
            showError(err.message || "Erreur lors de la sauvegarde");
        }
    };

    const handleExportPDF = async (evaluationId, evaluationName) => {
        const loadingToastId = info(`Exportation de "${evaluationName}" en cours...`, 60000);

        try {
            let { data } = await getEvaluationForGrading(evaluationId);
            const { evaluation, students, criteria, grades } = data.data;
            await generateEvaluationPDF(evaluation, students, criteria, grades);
            removeToast(loadingToastId);
            success('PDF exporté avec succès !');
        } catch (err) {
            console.error('Export Error:', err);
            removeToast(loadingToastId);
            showError('Erreur lors de l\'exportation du PDF.');
        }
    };

    if (loadingJournal) return <div className="loading-fullscreen">Chargement du journal...</div>;
    if (!currentJournal) return <div className="empty-state"><h3>Aucun journal sélectionné</h3></div>;
    if (loadingEvaluations) return <div className="loading-fullscreen">Chargement des évaluations...</div>;
    if (error) return <div className="error-message">{error}</div>;

    const isArchivedYear = currentJournal?.is_archived ?? false;

    return (
        <div className="correction-list-view">
            <div className="correction-header">
                <div className="header-title">
                    <h1>Évaluations ({currentJournal.name})</h1>
                    <p>Gérez et accédez aux corrections de vos évaluations.</p>
                </div>
                {!isArchivedYear && (
                    <div className="header-actions">
                        <button className="btn-primary" onClick={handleOpenCreateModal}>+ Créer une évaluation</button>
                    </div>
                )}
            </div>

            {!!isArchivedYear && <div className="archive-warning">Journal archivé. Modifications désactivées.</div>}

            <div className="evaluations-container">
                {Object.entries(groupedEvaluations).map(([className, classFolders]) => (
                    <div key={className} className="class-group">
                        <h2>Classe : {className}</h2>
                        {Object.entries(classFolders).map(([folderName, folderEvaluations]) => (
                            <div key={folderName} className="folder-group">
                                <h3><i className="fa-regular fa-folder"></i> {folderName}</h3>
                                <div className="evaluations-grid">
                                    {folderEvaluations.map(ev => (
                                        <div key={ev.id} className="evaluation-card">
                                            <div className="card-header">
                                                <h2>{ev.title}</h2>
                                                <div className="card-actions">
                                                    {!isArchivedYear && (
                                                        <button
                                                            onClick={() => handleOpenEditModal(ev)}
                                                            className="btn-edit"
                                                            title="Modifier"
                                                        >
                                                            <Pencil size={18} />
                                                        </button>
                                                    )}

                                                    <button
                                                        onClick={() => handleOpenCopyModal(ev)}
                                                        className="btn-copy"
                                                        title="Copier"
                                                    >
                                                        <Copy size={18} />
                                                    </button>

                                                    <button
                                                        onClick={() => handleExportPDF(ev.id, ev.name)}
                                                        className="btn-export"
                                                        title="Exporter en PDF"
                                                    >
                                                        <FileDown size={18}/>
                                                    </button>

                                                    {!isArchivedYear && (
                                                        <button
                                                            onClick={() => handleDeleteClick(ev)}
                                                            className="btn-delete"
                                                            title="Supprimer"
                                                        >
                                                            <Trash2 size={18}/>
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                            <Link to={`/correction/${ev.id}`} className="card-link-area">
                                                <div className="card-body">
                                                    <p><strong>Classe:</strong> {ev.class_name}</p>
                                                    <p><strong>Dossier:</strong> {ev.folder || 'Sans dossier'}</p>
                                                    <span className="card-date">{new Date(ev.evaluation_date).toLocaleDateString('fr-FR')}</span>
                                                </div>
                                                <div className="card-footer">
                                                    <span>{isArchivedYear ? 'Visualiser' : 'Corriger'}</span>
                                                </div>
                                            </Link>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                ))}
            </div>

            <EvaluationModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSave={handleSaveEvaluation}
                evaluation={editingEvaluation}
                evaluationToCopy={evaluationToCopy}
            />

            <ConfirmModal
                isOpen={confirmModal.isOpen}
                title={confirmModal.title}
                message={confirmModal.message}
                onClose={() => setConfirmModal({ isOpen: false })}
                onConfirm={confirmModal.onConfirm}
            />
        </div>
    );
};

export default CorrectionList;