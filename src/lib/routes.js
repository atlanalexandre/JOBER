// Table de correspondance écran <-> URL.
//
// L'écran affiché reste piloté par l'état `screen` dans App.jsx ; ce module ne fait
// que le refléter dans l'URL, pour que le navigateur ait enfin prise sur la navigation
// (bouton Retour, rechargement, liens partageables).

export const SCREEN_TO_PATH = {
  // Public
  splash:            "/",
  role:              "/auth/signin",
  auth_client:       "/auth/signin/client",
  auth_presta:       "/auth/signin/provider",
  reset_password:    "/auth/reset-password",
  how_client:        "/how-it-works/client",
  how_presta:        "/how-it-works/provider",
  client_onboarding: "/onboarding/client",
  presta_onboarding: "/onboarding/provider",
  pending_approval:  "/account/pending",
  presta_pending:    "/provider/pending",
  faq:               "/faq",
  legal:             "/legal",
  public_contact:    "/contact",

  // Backoffice (admin.alane.fr)
  bo_login:          "/admin",
  bo_dashboard:      "/admin/dashboard",

  // Espace client
  home:              "/dashboard",
  dashboard:         "/dashboard/stats",
  catalogue:         "/providers",
  search_filters:    "/providers/search",
  sector_detail:     "/sectors",
  profile:           "/providers/profile",
  cv:                "/providers/cv",
  booking:           "/booking",
  team_booking:      "/booking/team",
  stripe_pay:        "/booking/payment",
  mission_history:   "/missions",
  mission_request:   "/missions/new",
  mission_broadcast: "/missions/broadcast",
  mission_pending:   "/missions/pending",
  tracking:          "/missions/tracking",
  validation:        "/missions/validation",
  cancellation:      "/missions/cancellation",
  favorites:         "/favorites",
  cashback:          "/cashback",
  client_pro_docs:   "/account/documents",

  // Espace prestataire
  p_home:              "/provider/dashboard",
  p_missions:          "/provider/missions",
  p_dashboard:         "/provider/account",
  calendar:            "/provider/calendar",
  abonnement_presta:   "/provider/subscription",
  doc_upload:          "/provider/documents",
  presta_profile_edit: "/provider/profile",
  presta_pointage:     "/provider/check-in",
  micro_entreprise:    "/provider/micro-entreprise",
  payslip:             "/provider/payslip",

  // Commun aux deux espaces
  settings:        "/settings",
  notifications:   "/notifications",
  contact_support: "/support",
  chat:            "/messages",
  rating:          "/rating",
  contract:        "/contract",
  referral:        "/referral",
};

// Reverse. `splash` gagne sur "/" car c'est la page d'arrivée.
export const PATH_TO_SCREEN = Object.entries(SCREEN_TO_PATH)
  .reduce((acc, [scr, path]) => { if (!(path in acc)) acc[path] = scr; return acc; }, {});

// Écrans qui reçoivent un objet via navigate(to, data) : prestataire, mission, facture…
// Une URL seule ne suffit pas à les reconstruire, donc on ne les restaure pas au
// chargement direct. C'est l'objet de l'étape 2 (routes paramétrées /providers/:id).
export const NEEDS_DATA = new Set([
  "profile", "cv", "booking", "team_booking", "stripe_pay", "sector_detail",
  "mission_request", "mission_broadcast", "mission_pending", "tracking",
  "validation", "cancellation", "payslip", "chat", "rating",
  "contract", "presta_pointage",
]);

// Écrans accessibles sans session.
export const PUBLIC_SCREENS = new Set([
  "splash", "role", "auth_client", "auth_presta", "reset_password",
  "how_client", "how_presta", "client_onboarding", "presta_onboarding",
  "faq", "legal", "public_contact", "bo_login", "bo_dashboard",
]);

// Écrans de connexion : un utilisateur déjà authentifié n'a rien à y faire.
export const AUTH_SCREENS = new Set(["role", "auth_client", "auth_presta"]);

export const SIGNIN_PATH = "/auth/signin";

export function normalizePath(pathname) {
  if (!pathname) return "/";
  const p = pathname.replace(/\/+$/, "");
  return p === "" ? "/" : p;
}

export function pathForScreen(screen) {
  return SCREEN_TO_PATH[screen] || "/";
}

export function screenForPath(pathname) {
  return PATH_TO_SCREEN[normalizePath(pathname)] || null;
}
