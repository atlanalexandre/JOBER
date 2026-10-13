// Notifications sur le téléphone (14/10/2026).
//
// Les Réglages affichaient « Notifications : Activées » en dur, quel que soit
// l'état réel. Et la demande d'autorisation partait toute seule à l'ouverture
// de l'application : l'iPhone n'accepte cette demande qu'à la suite d'un geste
// de l'utilisateur, et l'ignorait. Un iPhone ne s'abonnait que si l'accord
// avait été donné d'un appui ailleurs — le bandeau « Activer les
// notifications » de l'accueil client, que les prestataires n'ont pas (en
// production le 14/10/2026 : 5 appareils Apple abonnés, dont 4 clients). Les
// erreurs étaient avalées (`catch {}`).
//
// Ici : l'état réel, et une activation déclenchée par un bouton.


export const estIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const installee = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;

export function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

/**
 * « actives » | « a_activer » | « bloquees » | « installer » (iPhone : seule
 * l'application ajoutée à l'écran d'accueil reçoit des notifications) |
 * « indisponibles » (navigateur sans notifications).
 */
export function etatNotifications() {
  if (typeof window === "undefined") return "indisponibles";
  const possible = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!possible) return estIOS() && !installee() ? "installer" : "indisponibles";
  if (Notification.permission === "denied") return "bloquees";
  if (Notification.permission === "granted") return "actives";
  return "a_activer";
}

/**
 * Abonne cet appareil et l'enregistre côté serveur. `demander` : afficher la
 * demande d'autorisation — à ne faire que sur un clic, sinon l'iPhone refuse.
 * Rend l'état obtenu ; lève une erreur au message lisible si l'enregistrement
 * échoue.
 */
export async function activerNotifications({ demander = true } = {}) {
  const etat = etatNotifications();
  if (etat === "installer" || etat === "indisponibles" || etat === "bloquees") return etat;
  const VAPID_PUBLIC = (import.meta.env.VITE_VAPID_PUBLIC_KEY || "").replace(/\s/g, "");
  if (!VAPID_PUBLIC) {
    console.error("[push] VITE_VAPID_PUBLIC_KEY absente : abonnement impossible.");
    throw new Error("Notifications non configurées sur ce site");
  }
  if (Notification.permission !== "granted") {
    if (!demander) return "a_activer";
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return perm === "denied" ? "bloquees" : "a_activer";
  }
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  let sub;
  try {
    sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
    });
  } catch (e) {
    // Le message du navigateur est en anglais et technique (« Registration
    // failed - push service error ») : on le garde pour le journal.
    console.error("[push] abonnement refusé par le navigateur :", e.name, e.message);
    throw new Error("Ce navigateur n'a pas pu s'abonner aux notifications", { cause: e });
  }
  await appelerApi("push_subscribe", { subscription: sub.toJSON() }, "Activation des notifications impossible");
  return "actives";
}

async function appelerApi(action, corps, messageEchec) {
  // Importé à la demande : le client Supabase exige ses variables d'environnement.
  const { supabase } = await import("./supabase.js");
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Session expirée : reconnectez-vous");
  const r = await fetch("/api/missions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}` },
    body: JSON.stringify({ action, ...corps }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error(`[push] ${action} refusé :`, r.status, j.error);
    throw new Error(j.error || messageEchec);
  }
  return j;
}

/**
 * Notification de test (Réglages, 14/10/2026). Réabonne d'abord cet appareil,
 * sans rien demander, pour que le test porte bien sur lui ; puis le serveur
 * écrit à tous les appareils du compte, cinq secondes plus tard. Rend son
 * bilan : { appareils, acceptes, expires, echecs: [{ service, raison }] }.
 */
export async function envoyerNotificationTest() {
  const etat = await activerNotifications({ demander: false });
  if (etat !== "actives") throw new Error(LIBELLE_NOTIFICATIONS[etat] || "Notifications non activées");
  const bilan = await appelerApi("push_test", {}, "Envoi de la notification de test impossible");
  // Le service a répondu que l'abonnement n'existe plus (le serveur l'a
  // retiré) : on en refait un neuf, sans quoi le téléphone resterait muet
  // alors que tout semble activé.
  if (bilan.expires > 0 && !bilan.acceptes) {
    try {
      const ancien = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (ancien) await ancien.unsubscribe();
      await activerNotifications({ demander: false });
      return { ...bilan, reinscrit: true };
    } catch (e) {
      console.error("[push] réinscription après expiration impossible :", e.message);
    }
  }
  return bilan;
}

/** Le bilan du test en une phrase : { ok, texte }. */
export function messageTest(bilan) {
  const { appareils = 0, acceptes = 0, expires = 0, echecs = [] } = bilan || {};
  if (appareils === 0) {
    return { ok: false, texte: "Aucun appareil enregistré : touchez « Notifications » pour les activer sur ce téléphone." };
  }
  if (acceptes > 0) {
    const combien = acceptes > 1 ? ` à vos ${acceptes} appareils` : "";
    return { ok: true, texte: `Notification envoyée${combien}. Si rien ne s'affiche, autorisez ALANE dans les réglages de notifications du téléphone.` };
  }
  if (echecs.length > 0) {
    return { ok: false, texte: `L'envoi a échoué : ${echecs[0].raison}. Désactivez puis réactivez les notifications, ou écrivez au support.` };
  }
  if (expires > 0) {
    return bilan.reinscrit
      ? { ok: false, texte: "Cet appareil n'était plus enregistré : il vient d'être réinscrit. Relancez le test." }
      : { ok: false, texte: "Cet appareil n'est plus enregistré auprès du service de notification. Fermez puis rouvrez l'application, et relancez le test." };
  }
  return { ok: false, texte: "Aucune notification n'a pu partir." };
}

export const LIBELLE_NOTIFICATIONS = {
  actives: "Activées",
  a_activer: "Désactivées — toucher pour activer",
  bloquees: "Bloquées dans les réglages du téléphone",
  installer: "Ajoutez ALANE à l'écran d'accueil pour les recevoir",
  indisponibles: "Non prises en charge par ce navigateur",
};

/**
 * Notification affichée par l'appareil lui-même (sans serveur). `new
 * Notification()` lève une erreur sur téléphone (Android : « Illegal
 * constructor ») : on passe par le service worker, comme les push.
 */
export async function notifierLocalement(titre, options = {}) {
  if (!("Notification" in window) || Notification.permission !== "granted") return false;
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg?.showNotification) { await reg.showNotification(titre, options); return true; }
    new Notification(titre, options);
    return true;
  } catch (e) {
    console.error("[notification locale] non affichée :", e.message);
    return false;
  }
}
