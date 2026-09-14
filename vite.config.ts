import { defineConfig } from 'vite';
import { resolve } from 'path';
import { execSync } from 'child_process';

let version: string;
try {
  // Exactly on a tag: use the clean tag name (e.g. "0.3.1").
  version = execSync('git describe --tags --exact-match').toString().trim().replace(/^v/, '');
} catch {
  try {
    // Between tags: tag + commit count + hash (e.g. "0.3.1-2-gabc1234").
    version = execSync('git describe --tags --long --always').toString().trim().replace(/^v/, '');
  } catch {
    version = '0.0.0-development';
  }
}

// No dev server and no dev proxy. The only local door is music-student's
// oauth2-proxy at :4180, which serves this `dist/` through nginx and routes
// /api to cafe-car on the same origin; `pnpm dev` is a watch build into that
// directory. A vite server would have to forge the X-Auth-Request-* headers,
// and everything auth-shaped (the cookie, session expiry, the CSRF header on a
// write, SSE through the proxy, sign-out) is exactly what a forgery cannot
// show.
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  root: 'src',
  publicDir: '../public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'src/index.html'),
    },
  },
  css: {
    postcss: './postcss.config.js',
  },
  optimizeDeps: {
    include: ['maplibre-gl', 'jszip', 'papaparse'],
  },
});
