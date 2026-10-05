// Dialogue avec l'extension « Outils Smartschool ».
//
// Une page web ne peut pas parler directement a une extension : le content
// script `journal-bridge.js` de l'extension ecoute `window.postMessage` sur le
// canal `prolixe-journal` et repond sur `prolixe-journal-reponse`. Sans
// extension, personne ne repond : d'ou le delai, au bout duquel on considere
// qu'elle est absente.

const CANAL = 'prolixe-journal';
const REPONSE = 'prolixe-journal-reponse';

let compteur = 0;

/**
 * Envoie une action a l'extension et rend sa reponse `{ ok, data | error }`.
 * Rejette si l'extension ne repond pas dans `delai` ms.
 */
export function askExtension(action, payload, delai = 1500) {
    return new Promise((resolve, reject) => {
        const id = `psx-${Date.now()}-${compteur += 1}`;
        const ecoute = (event) => {
            if (event.source !== window || event.origin !== window.location.origin) return;
            const msg = event.data;
            if (!msg || msg.canal !== REPONSE || msg.id !== id) return;
            window.removeEventListener('message', ecoute);
            clearTimeout(minuteur);
            resolve(msg);
        };
        const minuteur = setTimeout(() => {
            window.removeEventListener('message', ecoute);
            reject(new Error("L'extension Outils Smartschool ne répond pas."));
        }, delai);
        window.addEventListener('message', ecoute);
        window.postMessage({ canal: CANAL, id, action, payload }, window.location.origin);
    });
}

/** L'extension est-elle installee et a jour (elle connait les presences) ? */
export async function extensionHasPresences() {
    try {
        const res = await askExtension('presence-now', undefined, 1500);
        // Une extension trop ancienne repond « Action inconnue » : pas de bouton.
        return Boolean(res && (res.ok || !/Action inconnue/.test(res.error || '')));
    } catch {
        return false;
    }
}
