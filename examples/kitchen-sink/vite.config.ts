import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { stampPlugin } from '@browsagent/vite-plugin';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [stampPlugin({ root }), react()],
  server: {
    port: 4521,
    // The page calls a real backend. The context pass must see it.
    proxy: { '/api': 'http://127.0.0.1:4522' },
  },
});
