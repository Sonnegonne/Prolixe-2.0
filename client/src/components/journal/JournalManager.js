import React, { useState, useMemo } from 'react';
import { useJournal } from '../../hooks/useJournal';
import { useSchoolYears } from '../../hooks/useSchoolYear';
import { useToast } from '../../hooks/useToast';
import ConfirmModal from '../ConfirmModal';
import JournalService from '../../services/JournalService';
import { BookMarked, Download, Plus, FileJson } from 'lucide-react';
import './JournalManager.scss';

const JournalManager = () => {
    const {
        journals,
        currentJournal,
        archivedJournals,
        selectJournal,
        createJournal,
        archiveJournal,
        deleteArchivedJournal,
        clearJournal,
        loading: journalLoading,
        loadAllJournals,
    } = useJournal();

    const { schoolYears } = useSchoolYears();
    const { success, error: showError } = useToast();

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [formData, setFormData] = useState({ name: '', school_year_id: '' });
    const [confirmModal, setConfirmModal] = useState({
        isOpen: false,
        title: '',
        message: '',
        onConfirm: null,
        successMessage: ''
    });

    const [selectedFile, setSelectedFile] = useState(null);
    const [isImporting, setIsImporting] = useState(false);
    const [importTargetJournalId, setImportTargetJournalId] = useState('');

    const activeJournals = useMemo(() => journals.filter(j => !j.is_archived), [journals]);
    const otherActiveJournals = useMemo(() =>
            activeJournals.filter(j => j.id !== currentJournal?.id),
        [activeJournals, currentJournal]);

    const handleExport = async (id, name) => {
        try {
            const fileName = `export_${name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.json`;
            await JournalService.exportJournal(id, fileName);
            success('Exportation réussie !');
        } catch (err) {
            showError("Échec de l'exportation.");
        }
    };

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (file?.type === 'application/json') setSelectedFile(file);
        else {
            showError('Veuillez sélectionner un fichier JSON valide.');
            e.target.value = null;
        }
    };

    const handleImport = async () => {
        if (!selectedFile || !importTargetJournalId) return;
        setIsImporting(true);
        try {
            const response = await JournalService.importJournal(selectedFile, importTargetJournalId);
            success(response.message || 'Importation réussie !');
            loadAllJournals();
        } catch (err) {
            showError(err.message || 'Erreur lors de l\'importation.');
        } finally {
            setIsImporting(false);
            setSelectedFile(null);
            setImportTargetJournalId('');
        }
    };

    const showConfirm = (title, message, onConfirm, successMessage) => {
        setConfirmModal({ isOpen: true, title, message, onConfirm, successMessage });
    };

    const closeConfirmModal = () => setConfirmModal(prev => ({ ...prev, isOpen: false }));

    const handleFormChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            await createJournal(formData);
            success('Nouveau journal créé avec succès !');
            setIsModalOpen(false);
            setFormData({ name: '', school_year_id: '' });
        } catch (err) {
            showError(err.response?.data?.message || "Erreur lors de la création.");
        }
    };

    const JournalCard = ({ journal, type }) => {
        const isSelected = journal.id === currentJournal?.id;
        const isArchived = type === 'archived';
        const hasEntries = journal.entries_count > 0;

        return (
            <div className={`journal-card ${isArchived ? 'archived' : ''} ${isSelected ? 'current' : ''}`}>
                <div className="journal-info">
                    <div className="title-row">
                        <strong>{journal.name}</strong>
                        {isSelected && !isArchived && <span className="status-badge current">Actif</span>}
                        {isSelected && isArchived && <span className="status-badge selected">Visualisé</span>}
                    </div>
                    <div className="meta-row">
                        <span>{journal.year_label}</span>
                        {hasEntries && <small>{journal.entries_count} entrée(s)</small>}
                    </div>
                </div>

                <div className="journal-actions">
                    <button
                        onClick={() => handleExport(journal.id, journal.name)}
                        className="btn-export-icon"
                        title="Exporter"
                    >
                        <Download size={18} />
                    </button>

                    {!isSelected && (
                        <button onClick={() => selectJournal(journal)} className="btn-select">
                            {isArchived ? 'Visualiser' : 'Sélectionner'}
                        </button>
                    )}

                    {!isArchived && (
                        <>
                            <button
                                onClick={() => showConfirm(
                                    'Vider le journal',
                                    `Vider ${journal.name} ? Cette action est irréversible.`,
                                    () => clearJournal(journal.id),
                                    'Journal vidé.'
                                )}
                                className="btn-clear"
                                disabled={!hasEntries}
                            >
                                Vider
                            </button>
                            <button
                                onClick={() => showConfirm(
                                    'Archiver le journal',
                                    `Archiver ${journal.name} ? Il passera en lecture seule.`,
                                    () => archiveJournal(journal.id),
                                    'Journal archivé.'
                                )}
                                className="btn-archive"
                                disabled={activeJournals.length <= 1}
                            >
                                Archiver
                            </button>
                        </>
                    )}

                    {isArchived && (
                        <button
                            onClick={() => showConfirm(
                                'Supprimer le journal',
                                `Supprimer définitivement ${journal.name} ?`,
                                () => deleteArchivedJournal(journal.id),
                                'Journal supprimé.'
                            )}
                            className="btn-delete"
                        >
                            Supprimer
                        </button>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="journal-manager">
            <div className="section-header">
                <h2><BookMarked /> Gestion des Journaux</h2>
                <div className="controls-container">
                    <div className="import-box">
                        <select
                            value={importTargetJournalId}
                            onChange={(e) => setImportTargetJournalId(e.target.value)}
                            className="select-target"
                        >
                            <option value="">Importer dans...</option>
                            {activeJournals.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
                        </select>
                        <input type="file" id="import-input" accept=".json" onChange={handleFileChange} hidden />
                        <label htmlFor="import-input" className="file-label">
                            <FileJson size={16} /> <span>{selectedFile ? selectedFile.name : 'JSON'}</span>
                        </label>
                        {selectedFile && (
                            <button className="btn-run-import" onClick={handleImport} disabled={isImporting || !importTargetJournalId}>
                                OK
                            </button>
                        )}
                    </div>
                    <button className="btn-add-journal" onClick={() => setIsModalOpen(true)}>
                        <Plus size={18} /> <span>Nouveau</span>
                    </button>
                </div>
            </div>

            <div className="journal-lists">
                <section className="list-group">
                    <h3>Journal sélectionné</h3>
                    {currentJournal ? <JournalCard journal={currentJournal} type={currentJournal.is_archived ? 'archived' : 'active'} /> : <p className="empty-msg">Aucune sélection.</p>}
                </section>

                <section className="list-group">
                    <h3>Autres journaux actifs</h3>
                    {otherActiveJournals.length > 0 ?
                        otherActiveJournals.map(j => <JournalCard key={j.id} journal={j} type="active" />)
                        : <p className="empty-msg">Aucun autre journal actif.</p>
                    }
                </section>

                <section className="list-group">
                    <h3>Journaux archivés</h3>
                    {archivedJournals.length > 0 ?
                        archivedJournals.map(j => <JournalCard key={j.id} journal={j} type="archived" />)
                        : <p className="empty-msg">Aucun journal archivé.</p>
                    }
                </section>
            </div>

            {isModalOpen && (
                <div className="modal-overlay">
                    <div className="modal-card">
                        <div className="modal-header">
                            <h3>Nouveau journal</h3>
                            <button className="close-x" onClick={() => setIsModalOpen(false)}>✕</button>
                        </div>
                        <form onSubmit={handleSubmit} className="journal-form">
                            <div className="form-group">
                                <label>Nom du journal</label>
                                <input
                                    name="name"
                                    value={formData.name}
                                    onChange={handleFormChange}
                                    type="text"
                                    required
                                    placeholder="Ex: Année 2024"
                                />
                            </div>
                            <div className="form-group">
                                <label>Année scolaire</label>
                                <select
                                    name="school_year_id"
                                    value={formData.school_year_id}
                                    onChange={handleFormChange}
                                    required
                                >
                                    <option value="">-- Sélectionner --</option>
                                    {schoolYears.map(sy => (
                                        <option key={sy.id} value={sy.id}>
                                            {sy.label || `${sy.start_date} - ${sy.end_date}`}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-actions">
                                <button type="button" className="btn-cancel" onClick={() => setIsModalOpen(false)}>Annuler</button>
                                <button type="submit" className="btn-submit" disabled={!formData.name || !formData.school_year_id}>Créer</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <ConfirmModal
                isOpen={confirmModal.isOpen}
                title={confirmModal.title}
                message={confirmModal.message}
                onClose={closeConfirmModal}
                onConfirm={async () => {
                    try {
                        await confirmModal.onConfirm();
                        success(confirmModal.successMessage || 'Succès');
                    } catch (err) {
                        showError(err.message || 'Erreur');
                    } finally {
                        closeConfirmModal();
                    }
                }}
            />
        </div>
    );
};

export default JournalManager;