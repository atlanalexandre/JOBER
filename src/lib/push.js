// Notifications sur le téléphone (14/10/2026).
//
// Les Réglages affichaient « Notifications : Activées » en dur, quel que soit
// l'état réel. Et la demande d'autorisation partait toute seule à l'ouverture
// de l'application : l'iPhone n'accepte cette demande qu'à la suite d'un geste
// de l'utilisateur, et l'ignorait — un iPhone ne s'abonnait donc jamais, sans
// que personne le sache. Les erreurs étaient avalées (`catch {}`).
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
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
  });
  // Importé à la demande : le client Supabase exige ses variables d'environnement.
  const { supabase } = await import("./supabase.js");
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Session expirée : reconnectez-vous");
  const r = await fetch("/api/missions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}` },
    body: JSON.stringify({ action: "push_subscribe", subscription: sub.toJSON() }),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    console.error("[push] enregistrement refusé :", r.status, j.error);
    throw new Error(j.error || "Activation des notifications impossible");
  }
  return "actives";
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
