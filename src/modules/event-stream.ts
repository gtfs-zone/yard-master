/**
 * The feed's live channel: one `EventSource` against
 * `GET /api/feeds/{id}/events`, opened when a feed is selected and closed when
 * it stops being.
 *
 * Exactly one connection is held at a time. A long session switches feeds a
 * lot, and a stream that outlived its feed would keep pushing another feed's
 * events into a session that has moved on, as well as leaking a connection per
 * switch on both ends. `connect` therefore closes whatever was open before it
 * opens anything.
 *
 * **Reconnection is split in two, because the two failures are different.** A
 * dropped stream is the browser's own business: `EventSource` reconnects to it
 * without being asked, and interfering would only make it retry twice. A
 * response that was *not* an event stream is what the browser will not retry —
 * it closes the source for good — and that is almost always oauth2-proxy
 * answering an expired session with a login page. Reopening against one of
 * those forever is the infinite loop worth designing against, so it is retried
 * a few times with a backoff, for the case where cafe-car is merely restarting,
 * and then the page is reloaded so the browser can follow the redirect chain
 * and come back signed in. That is the same recovery `api-client.ts` performs
 * on a non-JSON response, for the same reason.
 *
 * Handlers are told which feed an event was for. A switch can land between an
 * event being sent and being delivered, and applying the old feed's status to
 * the new one would be a lie the reader has no way to spot.
 */

import { CONFIG } from '../config';
import type { FeedEvent, LoadStatus } from '../types/api';

export interface FeedEventHandlers {
  /** The feed's load status, current state first and then every change. */
  onLoad: (feedId: number, load: LoadStatus | null) => void;
}

export class FeedEventStream {
  private handlers: FeedEventHandlers;
  private source: EventSource | null = null;
  private feedId: number | null = null;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(handlers: FeedEventHandlers) {
    this.handlers = handlers;
  }

  /** Subscribe to a feed, dropping whatever was subscribed before. */
  connect(feedId: number): void {
    this.close();
    this.feedId = feedId;
    this.attempts = 0;
    this.open();
  }

  /** Drop the subscription. Safe to call when there is none. */
  close(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.source?.close();
    this.source = null;
    this.feedId = null;
  }

  private open(): void {
    const feedId = this.feedId;
    if (feedId === null) return;

    // Same origin, so the oauth2-proxy cookie rides along. No custom header is
    // possible on an `EventSource` and none is needed: this is a GET, and the
    // CSRF check only guards the unsafe methods.
    const source = new EventSource(`${CONFIG.API_BASE}/feeds/${feedId}/events`);
    this.source = source;

    // A stream that opened is a stream that answered `text/event-stream`, so
    // the budget is for the *next* failure rather than for the session.
    source.onopen = () => {
      this.attempts = 0;
    };

    source.onmessage = (event) => this.dispatch(feedId, event.data);

    source.onerror = () => {
      // Still connecting means the browser is retrying a dropped stream by
      // itself, which is the case that needs no help. Only a closed source is
      // ours to deal with.
      if (source.readyState !== EventSource.CLOSED) return;
      if (this.source !== source) return;
      this.scheduleRetry();
    };
  }

  private dispatch(feedId: number, data: string): void {
    let event: FeedEvent;
    try {
      event = JSON.parse(data) as FeedEvent;
    } catch {
      // A frame we cannot parse is one publisher's problem, not the stream's.
      return;
    }
    // An event type this build does not know about is dropped rather than
    // reported: the channel is deliberately open-ended.
    if (event.type === 'load') {
      this.handlers.onLoad(feedId, (event as { load: LoadStatus | null }).load);
    }
  }

  private scheduleRetry(): void {
    this.source?.close();
    this.source = null;

    if (this.attempts >= CONFIG.SSE_MAX_RETRIES) {
      // Out of retries against something that is not an event stream. A full
      // page load is the only thing that can follow an auth redirect chain.
      window.location.reload();
      return;
    }

    const delay = Math.min(
      CONFIG.SSE_RETRY_BASE_MS * 2 ** this.attempts,
      CONFIG.SSE_RETRY_MAX_MS
    );
    this.attempts += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
  }
}
