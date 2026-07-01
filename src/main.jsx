/* eslint-disable react-refresh/only-export-components */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from "@sentry/react"
import './index.css'
import App, { ErrorBoundary } from './App.jsx'

// ── Sentry — error tracking en production ─────────────────────────────────────
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    integrations: [Sentry.browserTracingIntegration()],
    beforeSend(event) {
      // Ne pas envoyer les erreurs de démo/dev
      if (import.meta.env.DEV) return null;
      return event;
    },
  });
}

// ── Global error tracking (fallback si Sentry absent) ────────────────────────
window.onerror = function (message, source, lineno, colno, error) {
  if (!SENTRY_DSN) console.error("[global error]", { message, source, lineno, colno, stack: error?.stack });
};

window.addEventListener("unhandledrejection", (event) => {
  if (!SENTRY_DSN) console.error("[unhandled rejection]", event.reason);
  else Sentry.captureException(event.reason);
});

// ── Web Vitals via PerformanceObserver natif (pas de dépendance npm) ──────────
function reportWebVital(name, value) {
  if (SENTRY_DSN) {
    Sentry.captureMessage(`[web-vital] ${name}: ${Math.round(value)}`, "info");
  } else if (!import.meta.env.PROD) {
    console.log(`[web-vital] ${name}:`, Math.round(value));
  }
}

try {
  new PerformanceObserver((list) => {
    const entries = list.getEntries();
    const last = entries[entries.length - 1];
    if (last) reportWebVital("LCP", last.startTime);
  }).observe({ type: "largest-contentful-paint", buffered: true });

  let clsValue = 0;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (!entry.hadRecentInput) clsValue += entry.value;
    }
    reportWebVital("CLS (score×1000)", clsValue * 1000);
  }).observe({ type: "layout-shift", buffered: true });

  new PerformanceObserver((list) => {
    const fcp = list.getEntries().find((e) => e.name === "first-contentful-paint");
    if (fcp) reportWebVital("FCP", fcp.startTime);
  }).observe({ type: "paint", buffered: true });
} catch {
  // PerformanceObserver non supporté — silencieux
}

// ── Enregistrement Service Worker (cache offline) ────────────────────────────
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
    console.warn("[SW] registration failed:", err);
  });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<ErrorBoundaryFallback />} showDialog={false}>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </Sentry.ErrorBoundary>
  </StrictMode>,
)

function ErrorBoundaryFallback() {
  return (
    <div style={{ minHeight: "100vh", background: "#050E20", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32, textAlign: "center" }}>
      <div style={{ fontSize: 64, marginBottom: 16 }}>😵</div>
      <h2 style={{ color: "#fff", fontSize: 22, fontWeight: 800, margin: "0 0 12px" }}>Une erreur inattendue s'est produite</h2>
      <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 14, maxWidth: 300, lineHeight: 1.7, margin: "0 auto 24px" }}>Nos équipes ont été notifiées automatiquement.</p>
      <button onClick={() => window.location.reload()} style={{ background: "#7C6FE0", border: "none", color: "#fff", borderRadius: 12, padding: "13px 28px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
        ↺ Recharger la page
      </button>
    </div>
  );
}
