/**
 * The one way this app talks to cafe-car.
 *
 * Three contracts live here and nowhere else:
 *
 * - **CSRF.** Every mutation carries `CONFIG.CSRF_HEADER`. The server mounts
 *   its check on the whole `/api` router, so a request that skips this helper
 *   is refused rather than quietly succeeding — but nothing should call `fetch`
 *   for a mutation directly, which is why the verbs are exported and the raw
 *   request function is not.
 * - **Session expiry.** oauth2-proxy answers an expired session with a 302 to
 *   Keycloak before the request reaches cafe-car, so what an XHR sees is a
 *   redirect chain ending in HTML. That is not an error payload and must never
 *   be parsed as one: the only recovery is a full page load, so the browser can
 *   follow the chain and come back signed in. Everything cafe-car builds itself
 *   is JSON including its errors, which is what makes "not JSON" unambiguous.
 * - **Errors.** A non-2xx JSON body carries FastAPI's `detail`, which is
 *   written for a person. `ApiError.message` is that string, so a caller can
 *   put it in a toast without unpacking anything.
 */

import { CONFIG } from '../config';
import type {
  Alert,
  AlertDetail,
  Assignment,
  Feed,
  FeedCreate,
  Me,
  People,
  Tracker,
  TrackerDetail,
  TrackerRule,
} from '../types/api';

/** A response cafe-car built: a status, and the `detail` it explained it with. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * Thrown after a reload has been asked for. Callers should let it propagate;
 * the page is on its way out, so there is nothing useful to show.
 */
export class SessionExpiredError extends Error {
  constructor() {
    super('Session expired');
    this.name = 'SessionExpiredError';
  }
}

/** True when the body is something cafe-car built, rather than a login page. */
function isJson(response: Response): boolean {
  return (response.headers.get('Content-Type') ?? '').includes('application/json');
}

/**
 * FastAPI's `detail` is a string for our own `HTTPException`s and a list of
 * per-field objects for a 422. Both are flattened to one line, because the
 * caller shows it in a toast.
 */
function describeDetail(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const lines = detail
      .map((item) => {
        if (!item || typeof item !== 'object') return String(item);
        const { loc, msg } = item as { loc?: unknown[]; msg?: string };
        const field = Array.isArray(loc) ? loc[loc.length - 1] : undefined;
        return field ? `${String(field)}: ${msg ?? ''}` : (msg ?? '');
      })
      .filter(Boolean);
    if (lines.length) return lines.join('; ');
  }
  return fallback;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') {
    headers[CONFIG.CSRF_HEADER] = '1';
    if (body !== undefined) headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${CONFIG.API_BASE}${path}`, {
    method,
    headers,
    // Same origin in every environment, so the cookie rides along by default;
    // stated anyway so a future change of origin fails loudly rather than
    // silently dropping the session.
    credentials: 'same-origin',
    ...(body !== undefined && { body: JSON.stringify(body) }),
    ...(signal && { signal }),
  });

  // Before the content-type check, because a deliberately empty body carries no
  // content type either and would otherwise look exactly like a login page.
  // Nothing oauth2-proxy or Keycloak serves is an empty 202/204.
  if (
    response.status === 202 ||
    response.status === 204 ||
    response.headers.get('Content-Length') === '0'
  ) {
    if (!response.ok) throw new ApiError(response.status, response.statusText);
    return undefined as T;
  }

  // The redirect chain has already been followed by the time we get here, so
  // what identifies it is the content type, not the status.
  if (!isJson(response)) {
    window.location.reload();
    throw new SessionExpiredError();
  }

  const payload = await response.json();
  if (!response.ok) {
    throw new ApiError(response.status, describeDetail(payload, response.statusText));
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) =>
    request<T>('GET', path, undefined, signal),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

// ─── The endpoints, named ─────────────────────────────────────────────────────
// Paths appear here once. A route renamed in cafe-car breaks in one place.

export const getMe = () => api.get<Me>('/me');

/**
 * Your feeds. `all` is the admin-only opt-in: the default scope deliberately
 * excludes the admin bypass, so an admin's switcher lists their own feeds
 * rather than every feed on the server.
 */
export const listFeeds = (all = false) => api.get<Feed[]>(`/feeds${all ? '?all=1' : ''}`);

export const getFeed = (feedId: number) => api.get<Feed>(`/feeds/${feedId}`);

export const createFeed = (body: FeedCreate) => api.post<Feed>('/feeds', body);

/** Queues a re-download. 202 means asked for, not done. */
export const reloadFeed = (feedId: number) =>
  api.post<void>(`/feeds/${feedId}/reload`);

export const listTrackers = (feedId: number) =>
  api.get<Tracker[]>(`/feeds/${feedId}/trackers`);

/** The only endpoint that serves `device_key`. */
export const getTracker = (trackerId: string) =>
  api.get<TrackerDetail>(`/trackers/${encodeURIComponent(trackerId)}`);

export const listAlerts = (feedId: number) => api.get<Alert[]>(`/feeds/${feedId}/alerts`);

export const getAlert = (alertId: number) => api.get<AlertDetail>(`/alerts/${alertId}`);

export const getPeople = (feedId: number) => api.get<People>(`/feeds/${feedId}/members`);

export const listRules = (feedId: number) =>
  api.get<TrackerRule[]>(`/feeds/${feedId}/rules`);

/** `from`/`to` are inclusive YYYY-MM-DD service dates in feed-local time. */
export const listAssignments = (feedId: number, from: string, to: string) =>
  api.get<Assignment[]>(
    `/feeds/${feedId}/assignments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  );
