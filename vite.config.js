// vite.config.js — settings for Vite, the tool that runs (npm run dev) and builds (npm run build) the app.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react'; // lets Vite understand React's JSX (<div>...</div> inside JavaScript)

export default defineConfig({
  plugins: [react()],
  // On GitHub Pages the site lives at /Doorbell-ph/, so links must start with that.
  // On your own computer it is just /.
  base: process.env.GITHUB_PAGES ? '/Doorbell-ph/' : '/',
  // port 5173: open http://localhost:5173 after "npm run dev". host: true also allows phones on the same Wi-Fi.
  server: { port: 5173, host: true },
  // The app is one big file (~1 MB); this only silences Vite's "large file" warning.
  build: { chunkSizeWarningLimit: 1500 },
});
