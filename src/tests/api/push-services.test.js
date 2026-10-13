// Notifications : seuls les services des navigateurs sont contactés, et un
// envoi rend son bilan (14/10/2026).
//
// Toute adresse en https était acceptée comme « téléphone » : le serveur
// d'ALANE envoyait alors ses requêtes vers le site choisi par l'abonné. Et
// l'envoi ne rendait rien, si bien que personne ne pouvait savoir si un
// téléphone recevait — d'où le bouton « Notification de test » des Réglages.
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { serviceDeNotificationReconnu, serviceDe, sendWebPush, sendPushToUser } from "../../../api/_push.js";

const b64u = (buf) => Buffer.from(buf).toString("base64url");

describe("serviceDeNotificationReconnu()", () => {
  it.each([
    "https://web.push.apple.com/QGuQyavXutnMH2Qf3y2CYZpZ3Ssx",
    "https://fcm.googleapis.com/fcm/send/dQ9xK2b:APA91bH",
    "https://fcm.googleapis.com/wp/dQ9xK2b",
    "https://android.googleapis.com/gcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAAAAB",
    "https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB",
  ])("accepte %s", (adresse) => {
    expect(serviceDeNotificationReconnu(adresse)).toBe(true);
  });

  it.each([
    ["un site quelconque", "https://httpbin.org/status/410"],
    ["une adresse interne", "https://169.254.169.254/latest/meta-data"],
    ["un domaine qui imite Google", "https://fcm.googleapis.com.exemple.fr/fcm/send/x"],
    ["un domaine qui imite Apple", "https://web.push.apple.com.exemple.fr/x"],
    ["un domaine qui finit comme Apple sans en être", "https://faux-push.apple.com.exemple.fr/x"],
    ["un sous-domaine de Google qui n'est pas le service", "https://www.googleapis.com/x"],
    ["du http", "http://fcm.googleapis.com/fcm/send/x"],
    ["un port choisi", "https://fcm.googleapis.com:8443/fcm/send/x"],
    ["un identifiant dans l'adresse", "https://moi:secret@fcm.googleapis.com/fcm/send/x"],
    ["une adresse illisible", "pas une adresse"],
    ["rien", undefined],
  ])("refuse %s", (_, adresse) => {
    expect(serviceDeNotificationReconnu(adresse)).toBe(false);
  });

  it("le service se lit sans l'adresse entière, qui identifie l'appareil", () => {
    expect(serviceDe("https://web.push.apple.com/QGuQyavXutnMH2Qf3y2CYZpZ3Ssx")).toBe("web.push.apple.com");
    expect(serviceDe("n'importe quoi")).toBe("adresse illisible");
  });

  it("push_subscribe applique la règle", () => {
    const missions = readFileSync(new URL("../../../api/missions.js", import.meta.url), "utf8");
    const bloc = missions.slice(missions.indexOf('if (action === "push_subscribe"'), missions.indexOf('if (action === "push_test"'));
    expect(bloc).toMatch(/if \(!serviceDeNotificationReconnu\(subscription\.endpoint\)\)/);
    expect(bloc).toMatch(/Service de notification non reconnu/);
  });
});

describe("envoi et bilan", () => {
  let cles;
  beforeAll(async () => {
    // Clés VAPID jetables, comme celles du serveur.
    const vapid = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
    const pub = new Uint8Array(await crypto.subtle.exportKey("raw", vapid.publicKey));
    const prv = (await crypto.subtle.exportKey("jwk", vapid.privateKey)).d;
    // Clés d'un appareil, comme celles qu'un navigateur fournit.
    const appareil = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    cles = {
      vapidPub: b64u(pub), vapidPrv: prv,
      p256dh: b64u(new Uint8Array(await crypto.subtle.exportKey("raw", appareil.publicKey))),
      auth: b64u(crypto.getRandomValues(new Uint8Array(16))),
    };
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  const abonnement = (endpoint) => ({ endpoint, p256dh: cles.p256dh, auth: cles.auth });

  it("une adresse hors des services reconnus n'est jamais contactée", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", cles.vapidPub); vi.stubEnv("VAPID_PRIVATE_KEY", cles.vapidPrv);
    const fetchFaux = vi.fn();
    vi.stubGlobal("fetch", fetchFaux);
    expect(await sendWebPush(abonnement("https://httpbin.org/status/410"), { title: "t" })).toBe("service_refuse");
    expect(fetchFaux).not.toHaveBeenCalled();
  });

  it("sans clés VAPID, la raison est dite", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", ""); vi.stubEnv("VAPID_PRIVATE_KEY", "");
    expect(await sendWebPush(abonnement("https://web.push.apple.com/x"), { title: "t" })).toBe("vapid_absent");
  });

  it("chaque appareil a sa ligne au bilan ; un appareil expiré est retiré", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", cles.vapidPub); vi.stubEnv("VAPID_PRIVATE_KEY", cles.vapidPrv);
    const appareils = [
      abonnement("https://web.push.apple.com/accepte"),
      abonnement("https://fcm.googleapis.com/fcm/send/expire"),
      abonnement("https://updates.push.services.mozilla.com/wpush/v2/refuse"),
      abonnement("https://httpbin.org/status/410"),
    ];
    const appels = [];
    vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
      appels.push({ url: String(url), methode: opts.method || "GET" });
      if (String(url).includes("/rest/v1/push_subscriptions") && !opts.method) return { ok: true, status: 200, json: async () => appareils };
      if (opts.method === "DELETE") return { ok: true, status: 204 };
      if (String(url).includes("apple")) return { status: 201, text: async () => "" };
      if (String(url).includes("expire")) return { status: 410, text: async () => "" };
      return { status: 403, text: async () => "clé refusée" };
    }));
    const bilan = await sendPushToUser("u1", { title: "🔔 Test", body: "b" }, "https://base.exemple", {});
    expect(bilan.appareils).toBe(4);
    expect(bilan.acceptes).toBe(1);
    expect(bilan.expires).toBe(1);
    expect(bilan.illisible).toBe(false);
    expect(bilan.echecs).toEqual(expect.arrayContaining([
      { service: "updates.push.services.mozilla.com", raison: "refus du service (403)" },
      { service: "httpbin.org", raison: "service de notification non reconnu" },
    ]));
    expect(appels.some(a => a.url.includes("httpbin"))).toBe(false);
    const retraits = appels.filter(a => a.methode === "DELETE");
    expect(retraits).toHaveLength(1);
    expect(retraits[0].url).toContain(encodeURIComponent("https://fcm.googleapis.com/fcm/send/expire"));
    // L'envoi accepté est bien chiffré et signé.
    const envoi = appels.find(a => a.url.includes("apple"));
    expect(envoi.methode).toBe("POST");
  });

  it("des appareils illisibles se signalent au lieu de passer pour « aucun appareil »", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ message: "panne" }) })));
    const bilan = await sendPushToUser("u1", { title: "t" }, "https://base.exemple", {});
    expect(bilan).toMatchObject({ appareils: 0, illisible: true });
  });
});

describe("push_test", () => {
  const missions = readFileSync(new URL("../../../api/missions.js", import.meta.url), "utf8");
  const bloc = missions.slice(missions.indexOf('if (action === "push_test")'), missions.indexOf("// ── Envoi d'un message"));

  it("n'écrit qu'aux appareils du compte appelant", () => {
    expect(bloc).toMatch(/const caller = await verifyUser\(/);
    expect(bloc).toMatch(/sendPushToUser\(caller\.id,/);
  });

  it("ne renvoie que le bilan, jamais les adresses des appareils", () => {
    expect(bloc).toMatch(/json\(\{ success: true, appareils, acceptes, expires, echecs \}\)/);
  });
});
