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
//
// The subject has to be alice's real Keycloak UUID, not her username. cafe-car
// keys a User on whatever `X-Auth-Request-User` carries, so a literal string
// mints a second account, and this door then shows a different world from the
// one at localhost:4180. music-student's scripts/reset.sh looks the UUID up
// the same way; both are doing what a real login would.
const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8090';
const DEV_EMAIL = process.env.DEV_EMAIL ?? 'alice@local';
const DEV_NAME = process.env.DEV_NAME ?? 'Alice Local';
const DEV_USERNAME = process.env.DEV_USERNAME ?? 'alice';
const DEV_ADMIN_GROUP = 'gtfs-admins';

/** Ask Keycloak's admin API for a realm user's `sub`, or null if it cannot. */
async function keycloakSubject(username: string): Promise<string | null> {
  const signal = AbortSignal.timeout(3000);
  try {
    const tokenResponse = await fetch(
      `${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token`,
      {
        method: 'POST',
        body: new URLSearchParams({
          client_id: 'admin-cli',
          grant_type: 'password',
          username: 'admin',
          password: 'admin',
        }),
        signal,
      },
    );
    if (!tokenResponse.ok) return null;
    const { access_token: token } = (await tokenResponse.json()) as { access_token?: string };
    if (!token) return null;

    const usersResponse = await fetch(
      `${KEYCLOAK_URL}/admin/realms/gtfs/users?username=${encodeURIComponent(username)}`,
      { headers: { Authorization: `Bearer ${token}` }, signal },
    );
    if (!usersResponse.ok) return null;
    const users = (await usersResponse.json()) as Array<{ id?: string }>;
    return users[0]?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * An unsigned JWT carrying the claims cafe-car reads off the access token.
 *
 * Only usable because the local admin app runs with `DEBUG=true`, which makes
 * it decode the bearer without verifying the signature. Without it the request
 * still authenticates by header alone, but arrives with no email and no group,
 * so every admin-only control disappears for no visible reason.
 */
function devToken(subject: string): string {
  const b64 = (value: object): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const claims = {
    sub: subject,
    email: DEV_EMAIL,
    email_verified: true,
    name: DEV_NAME,
    groups: [DEV_ADMIN_GROUP],
  };
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims)}.`;
}

/** The subject the dev proxy claims. Only meaningful when serving. */
async function devSubject(): Promise<string> {
  const resolved = process.env.DEV_SUBJECT ?? (await keycloakSubject(DEV_USERNAME));
  if (resolved) return resolved;
  // Loud, because the symptom otherwise is an empty account rather than an error.
  console.warn(
    `[yard-master] Keycloak at ${KEYCLOAK_URL} did not answer; the /api proxy is ` +
      `claiming to be "${DEV_USERNAME}", which is not the subject a real login uses. ` +
      `Start music-student, or set DEV_SUBJECT.`,
  );
  return DEV_USERNAME;
}

export default defineConfig(async ({ command }) => {
  const subject = command === 'serve' ? await devSubject() : DEV_USERNAME;

  return {
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
      // 8090 is Keycloak in the local music-student stack. Pinned so a collision
      // fails loudly instead of falling back to another port and leaving the HMR
      // websocket pointed at whatever holds 8090.
      port: 8091,
      strictPort: true,
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
            'X-Auth-Request-User': subject,
            'X-Auth-Request-Email': DEV_EMAIL,
            Authorization: `Bearer ${devToken(subject)}`,
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
  };
});
