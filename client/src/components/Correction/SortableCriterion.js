import React, { memo, useCallback } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Trash2, Plus, List } from 'lucide-react';

const SortableCriterion = memo(({
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

    const handleNameChange = useCallback((e) => onUpdate(index, 'name', e.target.value), [index, onUpdate]);
    const handlePointsChange = useCallback((e) => onUpdate(index, 'max_points', e.target.value), [index, onUpdate]);
    const handleSectionChange = useCallback((e) => onUpdate(index, 'section_name', e.target.value), [index, onUpdate]);
    const handleRemove = useCallback(() => onRemove(index), [index, onRemove]);
    const handleSwitchToSelect = useCallback(() => setCustomSection(id, false), [id, setCustomSection]);
    const handleSwitchToInput = useCallback(() => {
        onUpdate(index, 'section_name', '');
        setCustomSection(id, true);
    }, [id, index, onUpdate, setCustomSection]);

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
                                onChange={handleSectionChange}
                                className="input-text-custom"
                            />
                            {sections.length > 0 && (
                                <button
                                    type="button"
                                    className="toggle-btn"
                                    onClick={handleSwitchToSelect}
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
                                onChange={handleSectionChange}
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
                                onClick={handleSwitchToInput}
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
                        onChange={handleNameChange}
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
                        onChange={handlePointsChange}
                        className="input-points"
                    />
                </div>

                {/* --- BOUTON SUPPRIMER --- */}
                <button
                    type="button"
                    className="btn-delete-criterion"
                    onClick={handleRemove}
                    title="Supprimer ce critère"
                >
                    <Trash2 size={18} />
                </button>
            </div>
        </div>
    );
});

SortableCriterion.displayName = 'SortableCriterion';

export default SortableCriterion;