// client/src/hooks/useSchools.js
//
// L'ecole est le premier niveau de lecture de l'application : elle commande le
// journal courant, donc les classes, les eleves, les evaluations et l'horaire
// affiches. Ce provider est monte AU-DESSUS de JournalProvider, qui lit
// `currentSchoolId` pour choisir son journal.
//
// Comme JournalProvider, il se charge sur `isAuthenticated` et non au montage :
// monte au-dessus de la barriere d'auth, un fetch de montage partirait sans
// jeton et ne serait jamais rejoue apres le login (cf. CLAUDE.md).
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import SchoolService from '../services/SchoolService';
import { useAuth } from './useAuth';

const STORAGE_KEY = 'prolixe_currentSchoolId';

// `is_active` absent = serveur pas encore migre : l'ecole compte comme active.
const isActive = (school) => school.is_active === undefined || Boolean(Number(school.is_active));

const SchoolContext = createContext(null);

export const SchoolProvider = ({ children }) => {
    const { isAuthenticated } = useAuth();
    const [schools, setSchools] = useState([]);
    const [currentSchoolId, setCurrentSchoolId] = useState(() => {
        const stored = parseInt(localStorage.getItem(STORAGE_KEY), 10);
        return Number.isFinite(stored) ? stored : null;
    });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const loadSchools = useCallback(async () => {
        setLoading(true);
        try {
            const response = await SchoolService.getSchools();
            const all = response.data || [];
            setSchools(all);

            // L'ecole memorisee peut avoir ete supprimee ou desactivee entre
            // deux sessions : on retombe alors sur la premiere ecole active
            // plutot que sur un ecran vide.
            const active = all.filter(isActive);
            setCurrentSchoolId(previous => {
                if (previous && active.some(s => s.id === previous)) return previous;
                if (active.length > 0) return active[0].id;
                return all.length > 0 ? all[0].id : null;
            });
            setError(null);
        } catch (err) {
            setError(err.message || 'Erreur lors du chargement des écoles.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (isAuthenticated) {
            loadSchools();
        } else {
            setSchools([]);
            setCurrentSchoolId(null);
            setLoading(false);
        }
    }, [isAuthenticated, loadSchools]);

    useEffect(() => {
        if (currentSchoolId) localStorage.setItem(STORAGE_KEY, String(currentSchoolId));
    }, [currentSchoolId]);

    const selectSchool = useCallback((school) => {
        const id = typeof school === 'object' && school !== null ? school.id : school;
        if (id) setCurrentSchoolId(parseInt(id, 10));
    }, []);

    const createSchool = useCallback(async (data) => {
        const response = await SchoolService.createSchool(data);
        await loadSchools();
        return response.data;
    }, [loadSchools]);

    const updateSchool = useCallback(async (id, data) => {
        const response = await SchoolService.updateSchool(id, data);
        await loadSchools();
        return response.data;
    }, [loadSchools]);

    const deleteSchool = useCallback(async (id) => {
        await SchoolService.deleteSchool(id);
        await loadSchools();
    }, [loadSchools]);

    // Le reste de l'application ne voit que les ecoles actives : une ecole
    // desactivee sort de la bascule, du journal combine et de l'horaire.
    // Seul l'ecran de gestion lit `allSchools`, pour pouvoir la reactiver.
    const activeSchools = useMemo(() => schools.filter(isActive), [schools]);

    const currentSchool = useMemo(
        () => schools.find(s => s.id === currentSchoolId) || null,
        [schools, currentSchoolId]
    );

    // Tant qu'il n'y a qu'un etablissement actif, l'interface n'a aucune
    // raison de parler d'ecoles : les selecteurs et les pastilles s'effacent.
    const hasMultipleSchools = activeSchools.length > 1;

    // Recherche dans toutes les ecoles : un journal archive d'une ecole
    // desactivee garde son etiquette.
    const getSchoolById = useCallback(
        (id) => schools.find(s => s.id === parseInt(id, 10)) || null,
        [schools]
    );

    // Desactiver l'ecole affichee fait retomber loadSchools sur une ecole
    // active : le journal courant suit.
    const setSchoolActive = useCallback(async (id, active) => {
        await SchoolService.updateSchool(id, { is_active: active });
        await loadSchools();
    }, [loadSchools]);

    const value = {
        schools: activeSchools, allSchools: schools, setSchoolActive,
        currentSchool, currentSchoolId, hasMultipleSchools,
        loading, error,
        selectSchool, loadSchools, createSchool, updateSchool, deleteSchool, getSchoolById
    };

    return <SchoolContext.Provider value={value}>{children}</SchoolContext.Provider>;
};

export const useSchools = () => {
    const context = useContext(SchoolContext);
    if (!context) {
        throw new Error("useSchools doit être utilisé à l'intérieur d'un SchoolProvider");
    }
    return context;
};
