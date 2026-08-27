import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Estampille de build, écrite dans `dist/version.json` et injectée dans le
// bundle sous le nom `__BUILD_ID__`.
//
// POURQUOI
//
// Une application installée sur l'écran d'accueil n'est presque jamais fermée.
// Le service worker met bien à jour les fichiers, mais l'onglet ouvert continue
// d'exécuter le JavaScript chargé le premier jour. Le 27/08/2026, le
// back-office affichait encore un bouton « Seed démo prestataire » supprimé le
// 14/08 — deux semaines de retard, sur un écran qui manipule des comptes. Le
// même écart faisait croire qu'un correctif ne fonctionnait pas alors qu'il
// n'était simplement pas chargé.
//
// Sur une application qui manipule de l'argent, un client ne doit pas rester
// des semaines sur du code que l'on croit remplacé.
const BUILD_ID = String(Date.now());

const estampilleDeBuild = () => ({
  name: "estampille-de-build",
  apply: "build",
  generateBundle() {
    this.emitFile({
      type: "asset",
      fileName: "version.json",
      source: JSON.stringify({ build: BUILD_ID }),
    });
  },
});

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [react(), estampilleDeBuild()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) {
            return 'vendor-react';
          }
          if (
            id.includes('src/components/ui.jsx') ||
            id.includes('src/constants/colors.js') ||
            id.includes('src/constants/plans.js') ||
            id.includes('src/constants/data.js')
          ) {
            return 'ui-components';
          }
          if (id.includes('src/components/auth.jsx')) {
            return 'auth';
          }
          if (id.includes('src/components/backoffice.jsx')) {
            return 'backoffice';
          }
          if (id.includes('src/components/payment.jsx')) {
            return 'payment';
          }
          if (id.includes('src/components/presta-screens.jsx')) {
            return 'presta';
          }
          if (id.includes('src/components/client-screens.jsx')) {
            return 'client';
          }
        }
      }
    }
  },
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
    },
  },
})
