import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Trash2, Plus, List } from 'lucide-react';

const SortableCriterion = ({
                               id,
                               criterion,
                               index,
                               onUpdate,
                               onRemove,
                               sections = [],
                               isCustomSection,
                               setCustomSection,
                           }) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 100 : 1,
    };

    return (
        <div ref={setNodeRef} style={style} className="sortable-criterion-item">
            <div className="drag-handle" {...attributes} {...listeners}>
                <GripVertical size={18} />
            </div>

            <div className="criterion-inputs-row">
                {/* --- BLOC SECTION --- */}
                <div className="section-field">
                    {isCustomSection ? (
                        <div className="input-with-toggle">
                            <input
                                type="text"
                                placeholder="Nom de la section..."
                                value={criterion.section_name || ''}
                                onChange={(e) => onUpdate(index, 'section_name', e.target.value)}
                                className="input-text-custom"
                            />
                            {sections.length > 0 && (
                                <button
                                    type="button"
                                    className="toggle-btn"
                                    onClick={() => setCustomSection(false)}
                                    title="Choisir une section existante"
                                >
                                    <List size={14} />
                                </button>
                            )}
                        </div>
                    ) : (
                        <div className="input-with-toggle">
                            <select
                                value={criterion.section_name}
                                onChange={(e) => onUpdate(index, 'section_name', e.target.value)}
                                className="select-section"
                            >
                                <option value="" disabled>Choisir...</option>
                                {sections.map((s, i) => (
                                    <option key={`${s}-${i}`} value={s}>{s}</option>
                                ))}
                            </select>
                            <button
                                type="button"
                                className="toggle-btn"
                                onClick={() => {
                                    onUpdate(index, 'section_name', '');
                                    setCustomSection(true);
                                }}
                                title="Créer une nouvelle section"
                            >
                                <Plus size={14} />
                            </button>
                        </div>
                    )}
                </div>

                {/* --- BLOC NOM DU CRITÈRE --- */}
                <div className="name-field">
                    <input
                        type="text"
                        placeholder="Critère (ex: Orthographe...)"
                        value={criterion.name}
                        onChange={(e) => onUpdate(index, 'name', e.target.value)}
                        className="input-name"
                    />
                </div>

                {/* --- BLOC POINTS --- */}
                <div className="points-field">
                    <input
                        type="number"
                        step="0.25"
                        min="0"
                        placeholder="Pts"
                        value={criterion.max_points}
                        onChange={(e) => onUpdate(index, 'max_points', e.target.value)}
                        className="input-points"
                    />
                </div>

                {/* --- BOUTON SUPPRIMER --- */}
                <button
                    type="button"
                    className="btn-delete-criterion"
                    onClick={() => onRemove(index)}
                    title="Supprimer ce critère"
                >
                    <Trash2 size={18} />
                </button>
            </div>
        </div>
    );
};

export default SortableCriterion;