import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const srcDir = fileURLToPath(new URL('./src', import.meta.url));
const frontendDir = path.resolve(srcDir, '..');
// Local Windows/Termux loads VITE_* values from the repository-root .env.
// Vercel builds with frontend/ as its Root Directory, so use its injected env
// vars from the frontend root and never resolve files above that directory.
const envDir = process.env.VERCEL === '1' ? frontendDir : path.resolve(frontendDir, '..');

// Dev: `npm run dev` proxies /api to the FastAPI backend on 4173.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  envDir,
  resolve: {
    alias: {
      '@': path.resolve(srcDir),
    },
  },
  server: { host: '0.0.0.0', port: 5173, proxy: { '/api': 'http://127.0.0.1:4173' } },
});
