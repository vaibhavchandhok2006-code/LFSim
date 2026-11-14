import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the build works on GitHub Pages under /lfsim/
export default defineConfig({
  plugins: [react()],
  base: './',
  test: { environment: 'node' },
});
