import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Content-Security-Policy for the production build. The simulation worker is started from a blob: URL so it inherits
// this policy; firmware code running there cannot load scripts or connect to any other origin.
// 'unsafe-eval' is needed because Code mode compiles the translated firmware with new Function (inside the worker).
const CSP = [
  "default-src 'self'",
  "script-src 'self' blob: 'unsafe-eval'",
  "worker-src 'self' blob:",
  "connect-src 'self' blob: data:",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function csp(): Plugin {
  return {
    name: 'lfsim-csp',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
  };
}

// base './' so the build works on GitHub Pages under /lfsim/
export default defineConfig({
  plugins: [react(), csp()],
  base: './',
  worker: { format: 'es' },
  test: { environment: 'node' },
});
