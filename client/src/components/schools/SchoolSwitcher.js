// client/src/components/schools/SchoolSwitcher.js
//
// Bascule d'etablissement, posee en haut du menu. Elle ne s'affiche qu'a
// partir de deux ecoles : une enseignante mono-etablissement n'a pas a subir
// un selecteur qui n'ouvre qu'un choix.
import React, { useState } from 'react';
import { Check, ChevronDown, School } from 'lucide-react';
import { useSchools } from '../../hooks/useSchools';
import useOutsideClick from '../../hooks/useOutsideClick';
import './SchoolSwitcher.scss';

const SchoolSwitcher = ({ collapsed = false }) => {
    const { schools, currentSchool, selectSchool, hasMultipleSchools } = useSchools();
    const [isOpen, setIsOpen] = useState(false);

    const ref = useOutsideClick(() => setIsOpen(false));

    if (!hasMultipleSchools || !currentSchool) return null;

    const handleSelect = (school) => {
        selectSchool(school);
        setIsOpen(false);
    };

    return (
        <div className={`school-switcher${isOpen ? ' open' : ''}`} ref={ref}>
            <button
                type="button"
                className="school-current"
                onClick={() => setIsOpen(open => !open)}
                aria-expanded={isOpen}
                aria-label={`École : ${currentSchool.name}`}
                title={collapsed ? currentSchool.name : undefined}
                style={{ '--school-color': currentSchool.color }}
            >
                <span className="school-dot" aria-hidden="true">
                    {currentSchool.short_name ? currentSchool.short_name.slice(0, 2) : <School size={14} />}
                </span>
                <span className="school-label">
                    <span className="school-caption">École</span>
                    <span className="school-name">{currentSchool.name}</span>
                </span>
                <ChevronDown className="school-arrow" size={16} aria-hidden="true" />
            </button>

            {isOpen && (
                <ul className="school-list" role="listbox">
                    {schools.map(school => (
                        <li key={school.id}>
                            <button
                                type="button"
                                role="option"
                                aria-selected={school.id === currentSchool.id}
                                className={`school-option${school.id === currentSchool.id ? ' selected' : ''}`}
                                onClick={() => handleSelect(school)}
                                style={{ '--school-color': school.color }}
                            >
                                <span className="school-dot" aria-hidden="true">
                                    {school.short_name ? school.short_name.slice(0, 2) : '•'}
                                </span>
                                <span className="school-name">{school.name}</span>
                                {school.id === currentSchool.id && <Check size={14} aria-hidden="true" />}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default SchoolSwitcher;
