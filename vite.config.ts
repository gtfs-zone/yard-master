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

// Who the dev proxy claims to be. In production oauth2-proxy sets these and
// Traefik's ForwardAuth overwrites anything the client sent; locally there is
// no proxy, so vite forges them exactly as the curl recipe in cafe-car's
// CLAUDE.md does. DEV ONLY: this proxy block never ships, because the built
// site is served by nginx and /api is routed to cafe-car by Traefik.
const DEV_SUBJECT = process.env.DEV_SUBJECT ?? 'alice';
const DEV_EMAIL = process.env.DEV_EMAIL ?? 'alice@example.com';

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
  server: {
    port: 8090,
    open: true,
    host: true,
    proxy: {
      // Same-origin in production, so it must be same-origin in dev too: a
      // direct cross-origin fetch would need CORS that prod does not have,
      // and would hide preflight/cookie bugs until deploy.
      '/api': {
        target: 'http://localhost:8001',
        changeOrigin: true,
        headers: {
          'X-Auth-Request-User': DEV_SUBJECT,
          'X-Auth-Request-Email': DEV_EMAIL,
        },
      },
    },
  },
  css: {
    postcss: './postcss.config.js',
  },
  optimizeDeps: {
    include: ['maplibre-gl', 'jszip', 'papaparse'],
  },
});
