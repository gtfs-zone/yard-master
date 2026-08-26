/**
 * Which of a feed's two schedule sources is in play, and where each one's zip
 * is.
 *
 * A feed is either *linked* — pointed at somebody else's URL — or *hosted*,
 * meaning the zip was uploaded here, lives in object storage, and is published
 * at this feed's own permanent URL. Nothing else in the app switches on
 * `source_kind` directly: a null `static_feed_url` is the normal state of a
 * hosted feed, and every reader that used to treat that field as the whole
 * answer goes through here instead.
 *
 * The two URLs are deliberately different functions. `publicScheduleUrl` is
 * what cafe-car tells a *consumer*, which is an absolute prod URL by design
 * (its `PUBLIC_RT_BASE` is hardcoded rather than deploy config in a response
 * body). `scheduleFetchUrl` is what *this browser* downloads, and it is
 * always same-origin: `GET /api/feeds/{id}/schedule.zip` serves a hosted
 * feed's current upload and proxies a linked feed's URL server-side, so
 * `CONFIG.RT_BASE`, which may point at prod, never decides where a download
 * goes, and a linked feed's CORS policy never reaches the browser.
 */

import { CONFIG } from '../config';
import type { Feed } from '../types/api';

/** True for a feed whose zip this app stores and publishes. */
export function isHosted(feed: Feed): boolean {
  return feed.source_kind === 'hosted';
}

/** The permanent public URL of a hosted feed's zip, as a consumer is given it. */
export function publicScheduleUrl(feed: Feed): string | null {
  return feed.hosted_url;
}

/**
 * Where this browser downloads the schedule, or null for a feed that has none
 * yet — a hosted feed created a moment ago, before its first upload.
 */
export function scheduleFetchUrl(feed: Feed): string | null {
  const hasSchedule = isHosted(feed) ? feed.current_upload !== null : feed.static_feed_url !== null;
  return hasSchedule ? `${CONFIG.API_BASE}/feeds/${feed.id}/schedule.zip` : null;
}

/** How the source reads in a sentence, for a label or a toast. */
export function sourceLabel(feed: Feed): string {
  return isHosted(feed) ? 'Uploaded zip' : 'Linked URL';
}
