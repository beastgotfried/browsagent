import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'client.js',
    },
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    target: 'es2022',
  },
});
