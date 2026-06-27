import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App, { ErrorBoundary } from './App.jsx'

// ── Global error tracking ─────────────────────────────────────────────────────
window.onerror = function (message, source, lineno, colno, error) {
  console.error("[global error]", { message, source, lineno, colno, stack: error?.stack });
};

window.addEventListener("unhandledrejection", (event) => {
  console.error("[unhandled rejection]", event.reason);
});

// ── Web Vitals via PerformanceObserver natif (pas de dépendance npm) ──────────
function reportWebVital(name, value) {
  if (import.meta.env.PROD) return; // Silencieux en prod — brancher analytics ici si besoin
  console.log(`[web-vital] ${name}:`, Math.round(value));
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
    reportWebVital("CLS (score)", clsValue * 1000);
  }).observe({ type: "layout-shift", buffered: true });

  new PerformanceObserver((list) => {
    const fcp = list.getEntries().find((e) => e.name === "first-contentful-paint");
    if (fcp) reportWebVital("FCP", fcp.startTime);
  }).observe({ type: "paint", buffered: true });
} catch {
  // PerformanceObserver non supporté — silencieux
}

// ── Enregistrement Service Worker (cache offline) — indépendant du push ──────
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
    console.warn("[SW] registration failed:", err);
  });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
