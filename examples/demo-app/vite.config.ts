import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { stampPlugin } from '@browsagent/vite-plugin';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [
    stampPlugin({ root }),
    react(),
  ],
  server: { port: 4519 },
});
