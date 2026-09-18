// components/navigation/SideMenu.js
import React from 'react';
import { NavLink } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import useOutsideClick from '../../hooks/useOutsideClick'; // Assurez-vous que le chemin est correct
import SchoolSwitcher from '../schools/SchoolSwitcher';

import './SideMenu.scss';

const SideMenu = ({ isMenuOpen, toggleMenu, isCollapsed = false, toggleCollapse, canCollapse = false }) => {
    const { logout, user } = useAuth();
    const [isLogoutDropdownOpen, setIsLogoutDropdownOpen] = React.useState(false);

    // `user?.firstname[0]` plantait le rendu du menu dès qu'un prénom était
    // absent ou vide : l'optional chaining s'arrête à `user`.
    const initials = `${user?.firstname?.[0] || ''}${user?.name?.[0] || ''}`.toUpperCase();

    // Utilisation du hook pour détecter les clics en dehors du menu
    const menuRef = useOutsideClick(() => {
        if (isMenuOpen) {
            toggleMenu();
        }
    });

    const menuItems =  [
        { id: 'dashboard', label: 'Dashboard', icon: '📊', path: '/dashboard' },
        { id: 'journal', label: 'Journal', icon: '📝', path: '/journal' },
        { id: 'horaire', label: 'Emploi du temps', icon: '⏰', path: '/horaire' },
        { id: 'correction', label: 'Correction', icon: '✅', path: '/correction' },
        { id: 'conseilDeClasse', label: 'Conseil de classe', icon: '👥', path: '/conseilDeClasse' },
        { id: 'settings', label: 'Paramètres', icon: '⚙️', path: '/settings' },
    ];

    // Gère le clic sur un élément du menu de navigation
    const handleMenuItemClick = () => {
        setIsLogoutDropdownOpen(false);
        // Ferme le menu principal
        if (isMenuOpen) {
            toggleMenu();
        }
    };

    // Gère la déconnexion
    const handleLogout = () => {
        logout();
        setIsLogoutDropdownOpen(false);
    };

    // Gère le clic sur la zone du profil utilisateur pour basculer le menu déroulant
    const handleUserProfileClick = () => {
        setIsLogoutDropdownOpen(prev => !prev);
    };

    return (
        // On attache la référence au conteneur principal du menu
        <div
            ref={menuRef}
            className={`sidemenu ${isMenuOpen ? 'open' : 'closed'}${isCollapsed ? ' collapsed' : ''}`}
        >
            <div className="sidemenu-header">
                <div className="logo">
                    <span className="logo-icon">🎓</span>
                    <span className="logo-text">Prolixe</span>
                </div>

                {canCollapse && (
                    <button
                        type="button"
                        className="collapse-toggle"
                        onClick={toggleCollapse}
                        aria-label={isCollapsed ? 'Déployer le menu' : 'Replier le menu'}
                        aria-expanded={!isCollapsed}
                        title={isCollapsed ? 'Déployer le menu' : 'Replier le menu'}
                    >
                        {isCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
                    </button>
                )}
            </div>

            <div className="sidemenu-content">
                {/* Bascule d'etablissement : invisible tant qu'il n'y a qu'une ecole. */}
                <SchoolSwitcher collapsed={isCollapsed} />

                <nav className="sidemenu-nav">
                    <ul className="menu-list">
                        {menuItems.map(item => (
                            <li key={item.id} className="menu-item">
                                <NavLink
                                    to={item.path}
                                    className="menu-link"
                                    onClick={handleMenuItemClick}
                                    title={item.label}
                                >
                                    <span className="menu-icon">{item.icon}</span>
                                    <span className="menu-label">{item.label}</span>
                                </NavLink>
                            </li>
                        ))}
                    </ul>
                </nav>

                <div className="sidemenu-footer">
                    <div className={`user-menu-dropdown ${isLogoutDropdownOpen ? 'active' : ''}`}>
                        <button
                            type="button"
                            className="user-profile"
                            onClick={handleUserProfileClick}
                            aria-expanded={isLogoutDropdownOpen}
                            aria-label="Menu du compte"
                            title={isCollapsed ? user?.name || 'Menu du compte' : undefined}
                        >
                            <div className="user-avatar">{initials || '?'}</div>
                            <div className="user-info">
                                <span className="user-name">{user?.name}</span>
                                <span className="user-role">{user?.role}</span>
                            </div>
                            <span className="dropdown-arrow"></span>
                        </button>

                        <div className="dropdown-content">
                            <button onClick={handleLogout} className="logout-btn">
                                Déconnexion
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SideMenu;