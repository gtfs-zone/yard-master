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
 *   put it in a toast without unpacking anything. A 422's `detail` is a list of
 *   per-field objects instead, and `ApiError.fields` keeps that shape as well
 *   as flattening it, so a form can put each message next to the input that
 *   caused it rather than in one long line at the top.
 */

import { CONFIG } from '../config';
import type { VehiclePosition } from '../map-controller';
import type {
  Alert,
  AlertDetail,
  AlertWrite,
  Assignment,
  Feed,
  FeedCreate,
  FeedUpdate,
  GtfsUpload,
  InformedEntity,
  InformedEntityWrite,
  Me,
  Members,
  Provisioning,
  RuleException,
  RuleExceptionWrite,
  RuleWrite,
  ShareResult,
  Tracker,
  TrackerBulkCreate,
  TrackerCreate,
  TrackerDetail,
  TrackerRule,
  TrackerUpdate,
} from '../types/api';

/** A response cafe-car built: a status, and the `detail` it explained it with. */
export class ApiError extends Error {
  readonly status: number;

  /**
   * A 422's messages, keyed by the field each one names. Empty for every other
   * status, including a 409, which is a whole-request conflict that only the
   * caller knows which field to blame.
   */
  readonly fields: Record<string, string>;

  constructor(status: number, detail: string, fields: Record<string, string> = {}) {
    super(detail);
    this.name = 'ApiError';
    this.status = status;
    this.fields = fields;
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

/**
 * A 422's per-field messages, keyed by field.
 *
 * `loc` is the path into the request body — `["body", "nickname"]` — so the
 * last element is the field a form can point at. A `loc` that stops at `body`
 * is a whole-object validator, which has no field to blame and is left to the
 * flattened message.
 */
function fieldErrors(body: unknown): Record<string, string> {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (!Array.isArray(detail)) return {};
  const fields: Record<string, string> = {};
  for (const item of detail) {
    if (!item || typeof item !== 'object') continue;
    const { loc, msg } = item as { loc?: unknown[]; msg?: string };
    if (!Array.isArray(loc) || loc.length < 2 || !msg) continue;
    const field = String(loc[loc.length - 1]);
    // Pydantic prefixes its own messages; the form has the label already.
    fields[field] ??= msg.replace(/^Value error, /, '');
  }
  return fields;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal
): Promise<T> {
  // A schedule upload is the one write that is not JSON. `Content-Type` is
  // left unset for it on purpose: only the browser can write the multipart
  // boundary, and a hand-written header would name one the body does not use.
  const isForm = body instanceof FormData;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') {
    headers[CONFIG.CSRF_HEADER] = '1';
    if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${CONFIG.API_BASE}${path}`, {
    method,
    headers,
    // Same origin in every environment, so the cookie rides along by default;
    // stated anyway so a future change of origin fails loudly rather than
    // silently dropping the session.
    credentials: 'same-origin',
    ...(body !== undefined && { body: isForm ? body : JSON.stringify(body) }),
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
    throw new ApiError(
      response.status,
      describeDetail(payload, response.statusText),
      fieldErrors(payload)
    );
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

/**
 * Store a schedule zip, make it the feed's source and queue the load.
 *
 * Multipart rather than JSON, which is what `FormData` here selects: the
 * request still goes through this helper, so it still carries the CSRF header
 * and still handles an expired session. A rejected zip is a 422 naming `file`,
 * which is what puts the message under the drop zone.
 */
export const uploadSchedule = (feedId: number, file: File) => {
  const form = new FormData();
  form.append('file', file);
  return api.post<GtfsUpload>(`/feeds/${feedId}/uploads`, form);
};

/** This feed's upload history, newest first. Empty for a linked feed. */
export const listUploads = (feedId: number) =>
  api.get<GtfsUpload[]>(`/feeds/${feedId}/uploads`);

/** Roll back to an earlier upload. A pointer move *and* a re-load. */
export const activateUpload = (feedId: number, uploadId: string) =>
  api.post<GtfsUpload>(
    `/feeds/${feedId}/uploads/${encodeURIComponent(uploadId)}/activate`
  );

/** Forget one upload. Refused with a 409 for the one being served. */
export const deleteUpload = (feedId: number, uploadId: string) =>
  api.del<void>(`/feeds/${feedId}/uploads/${encodeURIComponent(uploadId)}`);

/** Queues a re-download. 202 means asked for, not done. */
export const reloadFeed = (feedId: number) =>
  api.post<void>(`/feeds/${feedId}/reload`);

export const listTrackers = (feedId: number) =>
  api.get<Tracker[]>(`/feeds/${feedId}/trackers`);

/** The only endpoint that serves `device_key`. */
export const getTracker = (trackerId: string) =>
  api.get<TrackerDetail>(`/trackers/${encodeURIComponent(trackerId)}`);

/**
 * The feed's whole live fleet, in one request.
 *
 * The bootstrap for the map: the event channel pushes each fix as it lands, so
 * a client that has just selected a feed would otherwise show an empty map
 * until every tracker had reported once. Presence is freshness — a position
 * record carries a 60s TTL — so a tracker missing from this list has not
 * reported in the last minute, not "has never reported".
 */
export const listTrackerPositions = (feedId: number) =>
  api.get<VehiclePosition[]>(`/feeds/${feedId}/tracker-positions`);

export const listAlerts = (feedId: number) => api.get<Alert[]>(`/feeds/${feedId}/alerts`);

export const getAlert = (alertId: number) => api.get<AlertDetail>(`/alerts/${alertId}`);

export const getMembers = (feedId: number) => api.get<Members>(`/feeds/${feedId}/members`);

export const listRules = (feedId: number) =>
  api.get<TrackerRule[]>(`/feeds/${feedId}/rules`);

/** `from`/`to` are inclusive YYYY-MM-DD service dates in feed-local time. */
export const listAssignments = (feedId: number, from: string, to: string) =>
  api.get<Assignment[]>(
    `/feeds/${feedId}/assignments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  );

/** The tracker is fixed at creation, so it is in the path and not the body. */
export const createRule = (trackerId: string, body: RuleWrite) =>
  api.post<TrackerRule>(`/trackers/${encodeURIComponent(trackerId)}/rules`, body);

/** Replaces the whole recurrence. The exceptions on it are left alone. */
export const updateRule = (ruleId: number, body: RuleWrite) =>
  api.patch<TrackerRule>(`/rules/${ruleId}`, body);

/** Takes the rule's exceptions with it. */
export const deleteRule = (ruleId: number) => api.del<void>(`/rules/${ruleId}`);

/**
 * Add or replace one date's exception. Writing a date the rule already has an
 * exception for replaces its type rather than conflicting, so "skip this day"
 * and "run it after all" are the same call with a different word.
 */
export const addRuleException = (ruleId: number, body: RuleExceptionWrite) =>
  api.post<RuleException>(`/rules/${ruleId}/exceptions`, body);

/** Drops the exception, putting the date back under the weekday flags. */
export const deleteRuleException = (ruleId: number, exceptionId: number) =>
  api.del<void>(`/rules/${ruleId}/exceptions/${exceptionId}`);

export const updateFeed = (feedId: number, body: FeedUpdate) =>
  api.patch<Feed>(`/feeds/${feedId}`, body);

/** Irreversible: the trackers, alerts and published URLs go with it. */
export const deleteFeed = (feedId: number) => api.del<void>(`/feeds/${feedId}`);

/** Owner-only, and only to somebody who is already a member. */
export const transferFeed = (feedId: number, newOwnerId: number) =>
  api.post<Feed>(`/feeds/${feedId}/transfer`, { new_owner_id: newOwnerId });

/** Answers with the detail form: a new tracker is about to be provisioned. */
export const createTracker = (feedId: number, body: TrackerCreate) =>
  api.post<TrackerDetail>(`/feeds/${feedId}/trackers`, body);

export const createTrackers = (feedId: number, body: TrackerBulkCreate) =>
  api.post<Tracker[]>(`/feeds/${feedId}/trackers/bulk`, body);

export const updateTracker = (trackerId: string, body: TrackerUpdate) =>
  api.patch<Tracker>(`/trackers/${encodeURIComponent(trackerId)}`, body);

/** Deletes its assignment rules with it, and retires its Traccar device. */
export const deleteTracker = (trackerId: string) =>
  api.del<void>(`/trackers/${encodeURIComponent(trackerId)}`);

/** As secret as the credential itself: the QR encodes it. Panel only. */
export const getProvisioning = (trackerId: string) =>
  api.get<Provisioning>(`/trackers/${encodeURIComponent(trackerId)}/provisioning`);

export const createAlert = (feedId: number, body: AlertWrite) =>
  api.post<AlertDetail>(`/feeds/${feedId}/alerts`, body);

export const updateAlert = (alertId: number, body: AlertWrite) =>
  api.patch<AlertDetail>(`/alerts/${alertId}`, body);

export const deleteAlert = (alertId: number) => api.del<void>(`/alerts/${alertId}`);

export const createEntity = (alertId: number, body: InformedEntityWrite) =>
  api.post<InformedEntity>(`/alerts/${alertId}/entities`, body);

export const deleteEntity = (alertId: number, entityId: number) =>
  api.del<void>(`/alerts/${alertId}/entities/${entityId}`);

/** 201 whether it made a member or an invite; the result says which. */
export const addMember = (feedId: number, email: string) =>
  api.post<ShareResult>(`/feeds/${feedId}/members`, { email });

export const removeMember = (feedId: number, userId: number) =>
  api.del<void>(`/feeds/${feedId}/members/${userId}`);

export const revokeInvite = (feedId: number, inviteId: number) =>
  api.del<void>(`/feeds/${feedId}/invites/${inviteId}`);
