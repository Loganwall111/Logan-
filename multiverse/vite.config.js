import { defineConfig } from 'vite';

// Dev/preview servers bind to 0.0.0.0 and accept any host so the sandbox
// live-preview proxy (https://{port}-{sandbox}.e2b.app) is allowed.
export default defineConfig({
  server: { host: '0.0.0.0', port: 5173, strictPort: true, allowedHosts: true },
  preview: { host: '0.0.0.0', port: 4173, strictPort: true, allowedHosts: true },
  build: { chunkSizeWarningLimit: 2000 },
});
