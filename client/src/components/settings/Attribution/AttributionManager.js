import { useSchools } from '../../../hooks/useSchools';
import React, { useState, useEffect } from 'react';
import AttributionService from '../../../services/AttributionService';
import { useSchoolYears } from "../../../hooks/useSchoolYear";
import { useToast } from '../../../hooks/useToast';
import ConfirmModal from '../../ConfirmModal';
import SchoolYearDisplay from '../../../hooks/SchoolYearDisplay';
import { format } from 'date-fns';
import { Briefcase, Plus, X, Pencil, Trash2, Copy, ChevronDown, ChevronRight } from 'lucide-react'; // Imports icônes pour le look moderne
import { summarizeYearHours, formatHours } from '../../../utils/attributionHours';
import './AttributionManager.scss';

// L'API renvoie déjà des dates 'YYYY-MM-DD' (pool mysql2 en dateStrings).
// On évite le détour par new Date(), qui les interprète en UTC et peut
// décaler d'un jour la valeur affichée dans un input type="date".
const toInputDate = (value) => {
    if (!value) return '';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
    return format(new Date(value), 'yyyy-MM-dd');
};

const FORM_TITLES = {
    create: 'Nouvelle attribution',
    edit: 'Modifier',
    duplicate: 'Dupliquer'
};

const AttributionManager = () => {
    const { schoolYears, loading: schoolYearsLoading } = useSchoolYears();
    const { schools, currentSchoolId } = useSchools();
    const [attributions, setAttributions] = useState([]);
    const [attributionsLoading, setAttributionsLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [formMode, setFormMode] = useState('create'); // 'create' | 'edit' | 'duplicate'
    const [collapsedYears, setCollapsedYears] = useState(() => new Set());
    const [confirmModal, setConfirmModal] = useState({ isOpen: false, onConfirm: null });

    const [formData, setFormData] = useState({
        school_year_id: '',
        school_id: '',
        school_name: '',
        start_date: '',
        end_date: '',
        esi_hours: 0,
        ess_hours: 0,
        className: ''
    });

    const { success, error } = useToast();

    const fetchAttributions = async () => {
        setAttributionsLoading(true);
        try {
            const response = await AttributionService.getAttributions();
            setAttributions(response.data);
        } catch (err) {
            error('Erreur de chargement des attributions.');
        } finally {
            setAttributionsLoading(false);
        }
    };

    useEffect(() => { fetchAttributions(); }, []);

    const handleFormChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    // Champs du formulaire déduits d'une attribution existante, sans son id :
    // c'est la présence de l'id qui fait basculer AttributionService entre
    // PUT (mise à jour) et POST (création).
    const formFieldsFrom = (attribution) => ({
        school_year_id: attribution.school_year_id,
        school_id: attribution.school_id || '',
        school_name: attribution.school_name,
        start_date: toInputDate(attribution.start_date),
        end_date: toInputDate(attribution.end_date),
        className: attribution.class || '',
        esi_hours: attribution.esi_hours || 0,
        ess_hours: attribution.ess_hours || 0,
    });

    const handleAddNew = () => {
        setFormMode('create');
        setFormData({ school_year_id: '', school_id: currentSchoolId || '', school_name: '', start_date: '', end_date: '', esi_hours: 0, ess_hours: 0, className: '' });
        setShowForm(true);
    };

    const handleEdit = (attribution) => {
        setFormMode('edit');
        setFormData({ id: attribution.id, ...formFieldsFrom(attribution) });
        setShowForm(true);
    };

    // Duplication : on pré-remplit le formulaire avec les données de la source
    // mais sans id, donc rien n'est écrit en base tant que l'utilisateur n'a
    // pas validé. Annuler ne laisse aucune attribution orpheline.
    const handleDuplicate = (attribution) => {
        setFormMode('duplicate');
        setFormData(formFieldsFrom(attribution));
        setShowForm(true);
    };

    const handleSave = async (e) => {
        e.preventDefault();
        if (new Date(formData.start_date) >= new Date(formData.end_date)) {
            error("La date de fin doit être postérieure à la date de début.");
            return;
        }
        try {
            await AttributionService.saveAttribution(formData);
            success(formMode === 'duplicate' ? 'Attribution dupliquée.' : 'Attribution sauvegardée.');
            setShowForm(false);
            fetchAttributions();
        } catch (err) {
            error(err.message || 'Erreur lors de la sauvegarde.');
        }
    };

    const handleDelete = (attribution) => {
        setConfirmModal({
            isOpen: true,
            title: 'Supprimer l\'attribution',
            message: `Supprimer l'attribution pour ${attribution.school_name} ?`,
            onConfirm: async () => {
                try {
                    await AttributionService.deleteAttribution(attribution.id);
                    success('Supprimé avec succès.');
                    fetchAttributions();
                } catch (err) { error(err.message); }
                closeConfirmModal();
            }
        });
    };

    const closeConfirmModal = () => setConfirmModal({ isOpen: false, onConfirm: null });

    const groupedAttributions = attributions.reduce((acc, curr) => {
        const yearId = curr.school_year_id || 'unknown';
        (acc[yearId] = acc[yearId] || []).push(curr);
        return acc;
    }, {});

    const sortedGroupKeys = Object.keys(groupedAttributions).sort((a, b) => b - a);

    const toggleYear = (yearId) => {
        setCollapsedYears(prev => {
            const next = new Set(prev);
            if (next.has(yearId)) next.delete(yearId);
            else next.add(yearId);
            return next;
        });
    };

    // L'année de rentrée vient de SCHOOL_YEARS via l'alias school_year_start ;
    // repli sur le hook si un ancien cache ne le contient pas encore.
    const startYearOf = (yearId, items) =>
        items[0]?.school_year_start
        ?? schoolYears.find(sy => String(sy.id) === String(yearId))?.start_date;

    if (attributionsLoading || schoolYearsLoading) {
        return <div className="state-message">Chargement...</div>;
    }

    return (
        <div className="attribution-manager">
            <div className="manager-header">
                <div className="title-wrapper">
                    <div className="icon-box"><Briefcase size={24} color="white" /></div>
                    <div>
                        <h2>Mes Attributions</h2>
                        <p>Gérez vos informations professionnelles et contrats.</p>
                    </div>
                </div>
                <button className="add-attribution-btn" onClick={handleAddNew}>
                    <Plus size={18} /> Ajouter
                </button>
            </div>

            {showForm && (
                <div className="glass-modal-overlay">
                    <div className="glass-modal">
                        <h3>{FORM_TITLES[formMode]}</h3>
                        <form onSubmit={handleSave} className="attribution-form">
                            {/* Section Année Scolaire */}
                            <div className="input-group">
                                <label htmlFor="school_year_id">Année scolaire</label>
                                <select
                                    id="school_year_id"
                                    name="school_year_id"
                                    value={formData.school_year_id}
                                    onChange={handleFormChange}
                                    required
                                >
                                    <option value="">-- Choisir une période --</option>
                                    {schoolYears.map(sy => (
                                        <option key={sy.id} value={sy.id}>
                                            {new Date(sy.start_date).getFullYear()} - {new Date(sy.end_date).getFullYear()}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Section École et Classe */}
                            <div className="grid-row">
                                <div className="input-group flex-2">
                                    <label htmlFor="school_id">École</label>
                                    {/* L'ecole vient desormais de la liste des
                                        etablissements : le libelle est recopie
                                        cote serveur, une seule source fait foi. */}
                                    <select
                                        id="school_id"
                                        name="school_id"
                                        value={formData.school_id || ''}
                                        onChange={handleFormChange}
                                        required
                                    >
                                        <option value="">-- Sélectionner --</option>
                                        {schools.map(school => (
                                            <option key={school.id} value={school.id}>{school.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="input-group flex-1">
                                    <label htmlFor="className">Classe / Cours</label>
                                    <input
                                        id="className"
                                        name="className"
                                        type="text"
                                        value={formData.className}
                                        onChange={handleFormChange}
                                        placeholder="Ex: 3TTINFO"
                                    />
                                </div>
                            </div>

                            {/* Dates de l'attribution */}
                            <div className="div-container">
                                <div className="input-group">
                                    <label htmlFor="start_date">Date de début</label>
                                    <input
                                        id="start_date"
                                        name="start_date"
                                        type="date"
                                        value={formData.start_date}
                                        onChange={handleFormChange}
                                        required
                                    />
                                </div>
                                <div className="input-group">
                                    <label htmlFor="end_date">Date de fin</label>
                                    <input
                                        id="end_date"
                                        name="end_date"
                                        type="date"
                                        value={formData.end_date}
                                        onChange={handleFormChange}
                                        required
                                    />
                                </div>
                            </div>

                            {/* Heures (Important : type="number") */}
                            <div className="div-container">
                                <div className="input-group">
                                    <label htmlFor="esi_hours">Heures ESI</label>
                                    <input
                                        id="esi_hours"
                                        name="esi_hours"
                                        type="number"
                                        min="0"
                                        step="0.5"
                                        value={formData.esi_hours}
                                        onChange={handleFormChange}
                                        required
                                    />
                                </div>
                                <div className="input-group">
                                    <label htmlFor="ess_hours">Heures ESS</label>
                                    <input
                                        id="ess_hours"
                                        name="ess_hours"
                                        type="number"
                                        min="0"
                                        step="0.5"
                                        value={formData.ess_hours}
                                        onChange={handleFormChange}
                                        required
                                    />
                                </div>
                            </div>

                            <div className="modal-footer">
                                <button type="button" className="cancel-btn" onClick={() => setShowForm(false)}>
                                    Annuler
                                </button>
                                <button type="submit" className="confirm-btn">
                                    Sauvegarder l'attribution
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <div className="attribution-list">
                {sortedGroupKeys.map(yearId => {
                    const items = groupedAttributions[yearId];
                    const collapsed = collapsedYears.has(yearId);
                    const summary = summarizeYearHours(items, startYearOf(yearId, items));

                    return (
                    <div key={yearId} className={`year-group${collapsed ? ' is-collapsed' : ''}`}>
                        <h4 className="year-heading">
                            <button
                                type="button"
                                className="year-header"
                                onClick={() => toggleYear(yearId)}
                                aria-expanded={!collapsed}
                                title={collapsed ? 'Déplier l\'année' : 'Replier l\'année'}
                            >
                                {collapsed
                                    ? <ChevronRight className="year-chevron" size={18} />
                                    : <ChevronDown className="year-chevron" size={18} />}
                                <span className="year-title"><SchoolYearDisplay schoolYearId={yearId} /></span>
                                {summary && (
                                    <span className="year-totals">
                                        <span className="hours-summary">ESI {formatHours(summary.esi)}</span>
                                        <span className="hours-summary">ESS {formatHours(summary.ess)}</span>
                                        <span className="hours-summary is-total">Total {formatHours(summary.total)}</span>
                                    </span>
                                )}
                                <span className="year-rule" />
                                <span className="year-count">{items.length}</span>
                            </button>
                        </h4>
                        {!collapsed && items.map(item => (
                            <div className="attribution-item" key={item.id}>
                                <div className="item-details">
                                    <strong>{item.school_name} {item.class && ` - ${item.class}`}</strong>
                                    <p>Du {format(new Date(item.start_date), 'dd/MM/yyyy')} au {format(new Date(item.end_date), 'dd/MM/yyyy')}</p>
                                    <p className="hours-pill">ESI: {item.esi_hours}h | ESS: {item.ess_hours}h</p>
                                </div>
                                <div className="item-actions">
                                    <button className="btn-edit" title="Modifier" aria-label="Modifier" onClick={() => handleEdit(item)}><Pencil size={16}/></button>
                                    <button className="btn-duplicate" title="Dupliquer" aria-label="Dupliquer" onClick={() => handleDuplicate(item)}><Copy size={16}/></button>
                                    <button className="btn-delete" title="Supprimer" aria-label="Supprimer" onClick={() => handleDelete(item)}><Trash2 size={16}/></button>
                                </div>
                            </div>
                        ))}
                    </div>
                    );
                })}
            </div>

            <ConfirmModal
                isOpen={confirmModal.isOpen}
                title={confirmModal.title}
                message={confirmModal.message}
                onClose={closeConfirmModal}
                onConfirm={confirmModal.onConfirm}
                type="danger"
            />
        </div>
    );
};

export default AttributionManager;