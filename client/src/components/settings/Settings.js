import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import ClassesManager from "./Class/ClassManager";
import ScheduleManager from "./Schedule/ScheduleManager";
import HolidaysManager from "./holidays/HolidaysManager";
import JournalManager from "../journal/JournalManager";
import SchoolManager from "./School/SchoolManager";
import AttributionManager from "./Attribution/AttributionManager";
import StudentManager from "./Student/StudentManager";
import ScheduleCreator from "./Schedule/ScheduleCreator";
import SubjectManager from "./Subject/SubjectManager";
import { useAuth } from "../../hooks/useAuth";

// Assurez-vous que le chemin du CSS est correct
import './Settings.scss';

const Settings = () => {
    const location = useLocation();
    const { user } = useAuth();

    // État pour le menu hamburger (mobile)
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    // État pour les sections repliables (bureau)
    const [collapsed, setCollapsed] = useState({
        admin: false,
        user: false
    });

    const [activeTab, setActiveTab] = useState(() => {
        if (location.state?.activeTab) return location.state.activeTab;
        return user?.role === "ADMIN" ? 'journals' : 'classes';
    });

    // Fermer le menu mobile lors du changement d'onglet
    const handleTabChange = (tabId) => {
        setActiveTab(tabId);
        setIsMobileMenuOpen(false);
    };

    const toggleSection = (section) => {
        setCollapsed(prev => ({ ...prev, [section]: !prev[section] }));
    };

    useEffect(() => {
        if (location.state?.activeTab) {
            setActiveTab(location.state.activeTab);
        }
    }, [location.state]);

    // Définition des sections
    const sections = [];
    if (user?.role === "ADMIN") {
        sections.push({
            id: 'admin',
            title: 'Administration',
            tabs: [
                { id: 'holidays', label: 'Calendrier', icon: '📅' }
            ]
        });
    }

    sections.push({
        id: 'user',
        title: 'Ma Classe',
        tabs: [
            { id: 'schools', label: 'Écoles', icon: '🏛️' },
            { id: 'journals', label: 'Journaux', icon: '📚' },
            { id: 'schedule', label: 'Heures de cours', icon: '⏰' },
            { id: 'subjects', label: 'Matières', icon: '📖' },
            { id: 'classes', label: 'Classes', icon: '🏫' },
            { id: 'horaire', label: 'Horaire', icon: '🗓️' },
            { id: 'students', label: 'Élèves', icon: '👥' },
            { id: 'attributions', label: 'Attributions', icon: '💼' }
        ]
    });

    const renderTabContent = () => {
        switch (activeTab) {
            case 'schools': return <SchoolManager />;
            case 'journals': return <JournalManager />;
            case 'subjects': return <SubjectManager />;
            case 'classes': return <ClassesManager />;
            case 'students': return <StudentManager />;
            case 'schedule': return <ScheduleManager />;
            case 'holidays': return <HolidaysManager />;
            case 'attributions': return <AttributionManager />;
            case 'horaire': return <ScheduleCreator />;
            default: return <ClassesManager />;
        }
    };

    return (
        <div className="settings-page">
            {/* Overlay pour fermer le menu mobile en cliquant à côté */}
            <div
                className={`settings-mobile-overlay ${isMobileMenuOpen ? 'active' : ''}`}
                onClick={() => setIsMobileMenuOpen(false)}
            />

            {/* Bouton Hamburger Flottant (Visible uniquement sur mobile via CSS) */}
            <button
                className={`settings-mobile-trigger ${isMobileMenuOpen ? 'active' : ''}`}
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                aria-label="Menu des paramètres"
            >
                {isMobileMenuOpen ? '✕' : '⚙️'}
            </button>

            <div className="settings-header">
                <h1>⚙️ Paramètres</h1>
                <p>Gérez vos préférences et configurations</p>
            </div>

            <div className="settings-content">
                {/* Sidebar avec classe dynamique pour l'ouverture mobile */}
                <aside className={`settings-sidebar ${isMobileMenuOpen ? 'active' : ''}`}>
                    <nav className="settings-nav">
                        {sections.map((section) => (
                            <div
                                key={section.id}
                                className={`nav-section ${section.id}-section ${collapsed[section.id] ? 'collapsed' : ''}`}
                            >
                                <div className="section-header-toggle" onClick={() => toggleSection(section.id)}>
                                    <h3 className="section-title">{section.title}</h3>
                                    <span className="toggle-arrow">{collapsed[section.id] ? '▶' : '▼'}</span>
                                </div>

                                <div className="section-content">
                                    {section.tabs.map(tab => (
                                        <button
                                            key={tab.id}
                                            className={`settings-tab ${activeTab === tab.id ? 'active' : ''}`}
                                            onClick={() => handleTabChange(tab.id)}
                                        >
                                            <span className="tab-icon">{tab.icon}</span>
                                            <span className="tab-label">{tab.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </nav>
                </aside>

                <main className="settings-main">
                    {renderTabContent()}
                </main>
            </div>
        </div>
    );
};

export default Settings;