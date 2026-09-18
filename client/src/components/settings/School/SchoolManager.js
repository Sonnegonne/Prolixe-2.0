// client/src/components/settings/School/SchoolManager.js
//
// Gestion des établissements. C'est ici qu'on ajoute la deuxième école ; tout
// le reste (journal, classes, élèves, horaire) se crée ensuite dans l'école
// affichée, choisie par la bascule du menu.
import React, { useState } from 'react';
import { Building2, Pencil, Trash2, Plus } from 'lucide-react';
import { useSchools } from '../../../hooks/useSchools';
import { useToast } from '../../../hooks/useToast';
import ConfirmModal from '../../ConfirmModal';
import './SchoolManager.scss';

const PALETTE = ['#2563eb', '#db2777', '#0d9488', '#d97706', '#7c3aed', '#be123c'];
const EMPTY_FORM = { id: null, name: '', short_name: '', color: PALETTE[0] };

const SchoolManager = () => {
    const { schools, currentSchoolId, selectSchool, createSchool, updateSchool, deleteSchool, loading } = useSchools();
    const { success, error: showError } = useToast();

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [confirmModal, setConfirmModal] = useState({ isOpen: false, school: null });

    const openCreate = () => {
        setForm({ ...EMPTY_FORM, color: PALETTE[schools.length % PALETTE.length] });
        setIsModalOpen(true);
    };

    const openEdit = (school) => {
        setForm({
            id: school.id,
            name: school.name,
            short_name: school.short_name || '',
            color: school.color || PALETTE[0],
        });
        setIsModalOpen(true);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const name = form.name.trim();
        if (!name) return showError("Le nom de l'école est requis.");

        try {
            if (form.id) {
                await updateSchool(form.id, { name, short_name: form.short_name.trim(), color: form.color });
                success('École mise à jour.');
            } else {
                const created = await createSchool({ name, short_name: form.short_name.trim(), color: form.color });
                success('École créée. Créez-y maintenant un journal de classe.');
                if (created?.id) selectSchool(created.id);
            }
            setIsModalOpen(false);
        } catch (err) {
            showError(err.response?.data?.message || "Échec de l'enregistrement.");
        }
    };

    const handleDelete = async () => {
        const school = confirmModal.school;
        setConfirmModal({ isOpen: false, school: null });
        try {
            await deleteSchool(school.id);
            success('École supprimée.');
        } catch (err) {
            showError(err.response?.data?.message || 'Suppression impossible.');
        }
    };

    if (loading) return <div className="school-manager loading">⏳ Chargement…</div>;

    return (
        <div className="school-manager">
            <header className="manager-header">
                <div>
                    <h2><Building2 className="icon-lucid" /> Mes établissements</h2>
                    <p>Chaque école a son journal de classe, ses classes, ses élèves et son horaire.</p>
                </div>
                <button className="add-glass-btn" onClick={openCreate}>
                    <Plus size={16} /> Nouvelle école
                </button>
            </header>

            <div className="school-list">
                {schools.map(school => (
                    <div
                        key={school.id}
                        className={`school-card${school.id === currentSchoolId ? ' current' : ''}`}
                        style={{ '--school-color': school.color }}
                    >
                        <span className="school-badge">{school.short_name || school.name.slice(0, 2).toUpperCase()}</span>
                        <div className="school-info">
                            <strong>{school.name}</strong>
                            <span className="school-meta">
                                {school.journals_count} journal{school.journals_count > 1 ? 'aux' : ''}
                                {school.id === currentSchoolId && <em> · affichée</em>}
                            </span>
                        </div>
                        <div className="school-actions">
                            {school.id !== currentSchoolId && (
                                <button className="action-btn" onClick={() => selectSchool(school.id)}>Afficher</button>
                            )}
                            <button className="action-btn" onClick={() => openEdit(school)} aria-label="Modifier">
                                <Pencil size={16} />
                            </button>
                            {/* Une école qui porte encore un journal n'est pas
                                supprimable : le serveur refuse, autant ne pas
                                proposer le geste. */}
                            {school.journals_count === 0 && (
                                <button
                                    className="action-btn danger"
                                    onClick={() => setConfirmModal({ isOpen: true, school })}
                                    aria-label="Supprimer"
                                >
                                    <Trash2 size={16} />
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {isModalOpen && (
                <div className="glass-modal-overlay" onClick={() => setIsModalOpen(false)}>
                    <div className="glass-modal" onClick={e => e.stopPropagation()}>
                        <h3>{form.id ? "Modifier l'école" : 'Nouvelle école'}</h3>
                        <form onSubmit={handleSubmit}>
                            <div className="input-group">
                                <label htmlFor="school-name">Nom</label>
                                <input
                                    id="school-name"
                                    autoFocus
                                    placeholder="Institut Saint-Laurent"
                                    value={form.name}
                                    onChange={e => setForm({ ...form, name: e.target.value })}
                                />
                            </div>
                            <div className="input-group">
                                <label htmlFor="school-short">Abrégé (affiché sur les cours)</label>
                                <input
                                    id="school-short"
                                    maxLength={16}
                                    placeholder="ISL"
                                    value={form.short_name}
                                    onChange={e => setForm({ ...form, short_name: e.target.value })}
                                />
                            </div>
                            <div className="input-group">
                                <label>Couleur</label>
                                <div className="color-row">
                                    {PALETTE.map(color => (
                                        <button
                                            key={color}
                                            type="button"
                                            className={`color-dot${form.color === color ? ' selected' : ''}`}
                                            style={{ backgroundColor: color }}
                                            onClick={() => setForm({ ...form, color })}
                                            aria-label={`Couleur ${color}`}
                                        />
                                    ))}
                                </div>
                            </div>
                            <div className="modal-footer">
                                <button type="button" onClick={() => setIsModalOpen(false)}>Annuler</button>
                                <button type="submit" className="confirm-btn">Enregistrer</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <ConfirmModal
                isOpen={confirmModal.isOpen}
                title="Supprimer cette école ?"
                message={`« ${confirmModal.school?.name} » sera définitivement supprimée.`}
                onConfirm={handleDelete}
                onClose={() => setConfirmModal({ isOpen: false, school: null })}
            />
        </div>
    );
};

export default SchoolManager;
