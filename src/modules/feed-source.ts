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
 * body). `scheduleFetchUrl` is what *this browser* downloads, which has to
 * resolve against `CONFIG.RT_BASE` for the same reason the realtime links do:
 * a feed created against a local stack has no prod URL that answers.
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
  if (!isHosted(feed)) return feed.static_feed_url;
  if (!feed.current_upload) return null;
  return `${CONFIG.RT_BASE}/${encodeURIComponent(feed.feed_name)}/gtfs.zip`;
}

/** How the source reads in a sentence, for a label or a toast. */
export function sourceLabel(feed: Feed): string {
  return isHosted(feed) ? 'Uploaded zip' : 'Linked URL';
}
