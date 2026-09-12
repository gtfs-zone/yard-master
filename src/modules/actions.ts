/**
 * Every write the panel can start, in one place.
 *
 * A properties page is a synchronous string renderer: it emits a button
 * carrying `data-action` and knows nothing about what happens next.
 * `PanelRenderer` delegates the click here, and this module owns the form, the
 * confirmation, the request and the refresh that follows it. That is what lets
 * the pages stay pure and the writes stay auditable — there is one file to read
 * to find out everything this app can change.
 *
 * Two rules hold across all of it:
 *
 * - **Re-read, never patch.** After a write the affected list is fetched
 *   again, so the panel can only ever show rows the server confirmed. The
 *   responses are used for the toast and for navigation, not as a substitute
 *   for the list.
 * - **`device_key` goes nowhere.** It is an argument to no action, it is not
 *   in `data-arg`, and the provisioning dialog that does show it is opened by
 *   the tracker's surrogate id.
 */

import type {
  Alert,
  AlertWrite,
  Feed,
  GtfsUpload,
  InformedEntityWrite,
  RuleWrite,
  Tracker,
  TrackerDetail,
  TrackerRule,
} from '../types/api';
import { CONFIG } from '../config';
import type { AppState } from './app-state';
import type { FeedSession } from './feed-session';
import {
  activateUpload,
  addMember,
  addRuleException,
  createAlert,
  createEntity,
  createRule,
  createTracker,
  deleteAlert,
  deleteEntity,
  deleteFeed,
  deleteRule,
  deleteRuleException,
  deleteTracker,
  deleteUpload,
  getAlert,
  getProvisioning,
  reloadFeed,
  removeMember,
  revokeInvite,
  SessionExpiredError,
  transferFeed,
  updateAlert,
  updateFeed,
  updateRule,
  updateTracker,
} from './api-client';
import { confirmAction, confirmTyped } from './confirm';
import { isHosted, publicScheduleUrl } from './feed-source';
import { formatBytes } from './feed-download';
import { isHttpUrl, putSchedule, scheduleZipField } from './schedule-upload';
import { rtEnum } from '../gtfs-rt-spec/index';
import { tooltipLabelContent } from './spec-field';
import type { FieldOption, FormField } from './entity-form';
import { showEntityForm, weekdayBits, weekdayValue } from './entity-form';
import {
  agencyOptions,
  directionOptions,
  NO_SCHEDULE,
  routeOptions,
  routeTypeOptions,
  stopOptions,
} from './entity-id-options';
import {
  ALERT_CAUSES,
  ALERT_EFFECTS,
  ALERT_SEVERITIES,
  describeRecurrence,
  enumLabel,
  formatWindow,
  fromLocalInput,
  parseRuleTime,
  personLabel,
  ruleTimeInput,
  toLocalInput,
} from './managed-render';
import { parseGtfsClock } from './feed-time';
import { dayLabel, isServiceDate, today, WEEKDAY_KEYS, weekdayKey } from './service-date';
import { assignableTrips, tripLabel, tripName, tripOptions } from './trip-picker';
import { showModal } from './modal-utils';
import { notify } from './notification-system';
import { escHtml } from './render-utils';

/** One line of the cell menu: what it writes, and the write itself. */
interface MenuChoice {
  label: string;
  /** One sentence saying what this actually stores. */
  detail: string;
  className?: string;
  run: () => Promise<void>;
}

/**
 * The empty option plus one per enumeration value, labelled for reading.
 *
 * The label comes from the spec's curated `label` where there is one, so
 * `SIGNIFICANT_DELAYS` reads as `Significant delays` in exactly the wording
 * `src/gtfs-rt-spec/` records. `enumLabel` is the fallback for a value the
 * reference has since dropped but a stored alert still carries.
 */
function enumOptions(values: readonly string[], enumName: string): FieldOption[] {
  const spec = rtEnum(enumName);
  return [
    { value: '', label: '—' },
    ...values.map((v) => ({
      value: v,
      label: spec?.values.find((e) => e.value === v)?.label ?? enumLabel(v),
    })),
  ];
}

/** A blank string is an absent value everywhere in this module. */
function orNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** A whole number, or null for a field left empty. Never `NaN`. */
function orNullNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * `Once` writes every weekday false; the date it runs on is written
 * afterwards as an `added` exception, so a one-off and a day added to a
 * recurrence are the same object.
 */
function isOneOff(values: Record<string, string>): boolean {
  return values.repeats === 'once';
}

/** The same question, asked of a rule already on the server. */
function ruleIsOneOff(rule: TrackerRule): boolean {
  return !WEEKDAY_KEYS.some((key) => rule[key]);
}

export class Actions {
  private app: AppState;
  private session: FeedSession;

  constructor(app: AppState, session: FeedSession) {
    this.app = app;
    this.session = session;
  }

  /**
   * Run the action a panel button asked for.
   *
   * An unknown name is a programming error rather than something a person can
   * cause, so it is reported rather than swallowed. Everything else that goes
   * wrong is reported by the individual action, next to the field where that
   * is possible.
   */
  async run(action: string, arg: string): Promise<void> {
    try {
      switch (action) {
        case 'feed:edit':
          return await this.editFeed();
        case 'feed:delete':
          return await this.removeFeed();
        case 'feed:transfer':
          return await this.transferFeed();
        case 'feed:reload':
          return await this.reloadSchedule();
        case 'feed:replace-schedule':
          return await this.replaceSchedule();
        case 'feed:link-schedule':
          return await this.linkSchedule();
        case 'feed:copy-schedule-url':
          return await this.copyScheduleUrl();
        case 'feed:retry-uploads':
          return await this.app.refreshUploads();
        case 'upload:activate':
          return await this.activateSchedule(arg);
        case 'upload:delete':
          return await this.removeUpload(arg);
        case 'tracker:new':
          return await this.newTracker();
        case 'tracker:edit':
          return await this.editTracker(arg);
        case 'tracker:delete':
          return await this.removeTracker(arg);
        case 'tracker:provision':
          return await this.showProvisioning(arg);
        case 'alert:new':
          return await this.newAlert();
        case 'alert:edit':
          return await this.editAlert(arg);
        case 'alert:delete':
          return await this.removeAlert(arg);
        case 'entity:add':
          return await this.addEntity(arg);
        case 'entity:delete':
          return await this.removeEntity(arg);
        case 'assign:new':
          return await this.newAssignment(arg);
        case 'assign:new-for-trip':
          // From a trip page: the trip is settled, the date is not.
          return await this.newAssignment('', arg);
        case 'assign:edit':
          return await this.editAssignment(arg);
        case 'assign:delete':
          return await this.removeAssignment(arg);
        case 'assign:skip':
          return await this.exceptOneDay(arg, 'removed');
        case 'assign:add-day':
          return await this.exceptOneDay(arg, 'added');
        case 'assign:unexcept':
          return await this.undoException(arg);
        case 'assign:day':
          return await this.editOneDay(arg);
        case 'manager:add':
          return await this.addManager();
        case 'member:remove':
          return await this.removeManager(arg);
        case 'invite:revoke':
          return await this.revokePendingInvite(arg);
        default:
          notify.error(`No such action: ${action}`);
      }
    } catch (err) {
      // Everything reachable from a form reports its own failure inside the
      // form. This is the net under the confirmations and the reads.
      if (err instanceof SessionExpiredError) return;
      notify.error(err instanceof Error ? err.message : String(err));
    }
  }

  // ─── Feed ──────────────────────────────────────────────────────────────────

  private feedOrWarn(): Feed | null {
    const feed = this.session.feed;
    if (!feed) notify.warning('Select a feed first.');
    return feed;
  }

  private async editFeed(): Promise<void> {
    const feed = this.feedOrWarn();
    if (!feed) return;

    const updated = await showEntityForm<Feed>({
      title: `Edit ${feed.feed_name}`,
      conflictField: 'feed_name',
      fields: [
        {
          name: 'feed_name',
          label: 'Name',
          value: feed.feed_name,
          autofocus: true,
          tooltip: 'Appears in every public GTFS-RT URL this feed serves, so renaming it moves them.',
        },
      ],
      submit: (values) => updateFeed(feed.id, { feed_name: values.feed_name.trim() }),
    });
    if (!updated) return;

    // Owns the hash rewrite: `feed_name` is what a shareable link carries.
    this.app.adoptFeedRow(updated);
    notify.success(`Saved ${updated.feed_name}`);
  }

  /**
   * Point the feed at a URL, which is also how a hosted feed becomes a linked
   * one.
   *
   * One field, prefilled from whatever the feed is already linked to (empty
   * for a hosted feed). The server re-downloads the zip on this PATCH; this
   * browser re-downloads it too, so both copies match what the URL now says.
   */
  private async linkSchedule(): Promise<void> {
    const feed = this.feedOrWarn();
    if (!feed) return;

    const updated = await showEntityForm<Feed>({
      title: 'Load schedule from URL',
      submitLabel: 'Load',
      fields: [
        {
          name: 'static_feed_url',
          label: 'Scheduled feed URL',
          type: 'url',
          value: feed.static_feed_url,
          autofocus: true,
          placeholder: 'https://example.com/gtfs.zip',
          tooltip: 'Changing it re-downloads the schedule, here and on the server.',
        },
      ],
      validate: (values): Record<string, string> | null => {
        const url = values.static_feed_url.trim();
        if (!url) return { static_feed_url: 'A linked feed needs a scheduled feed URL' };
        if (!isHttpUrl(url)) return { static_feed_url: 'Must be a valid http or https URL' };
        return null;
      },
      submit: (values) =>
        updateFeed(feed.id, {
          source_kind: 'url',
          static_feed_url: values.static_feed_url.trim(),
        }),
    });
    if (!updated) return;

    this.app.adoptFeedRow(updated);
    notify.success(`Saved ${updated.feed_name}`);
    this.app.reloadScheduled();
  }

  /**
   * Put a new zip on the feed, which is also how a linked feed becomes a
   * hosted one.
   *
   * The upload is what flips `source_kind` and queues the load, so nothing
   * here patches the feed: it re-reads the row the server wrote.
   */
  /**
   * Ask cafe-car to re-download a linked feed's zip, and re-download it here.
   *
   * Two halves, deliberately: cafe-car re-downloads the zip for the schedule
   * pipeline, and this browser re-downloads it for the map. Neither is the
   * other. Offered on a linked feed only; a hosted one has no upstream, and
   * Replace schedule is its equivalent.
   */
  private async reloadSchedule(): Promise<void> {
    const feed = this.feedOrWarn();
    if (!feed) return;

    await reloadFeed(feed.id);
    notify.info(`Queued a reload of ${feed.feed_name}`);
    // The stream reports the load moving to `running` a moment from now, but
    // only once schedule-foamer picks the task up; re-reading the row keeps the
    // gap from looking like nothing happened.
    await this.app.refreshFeed();
    this.app.reloadScheduled();
  }

  private async replaceSchedule(): Promise<void> {
    const feed = this.feedOrWarn();
    if (!feed) return;

    const uploaded = await showEntityForm<GtfsUpload>({
      title: isHosted(feed) ? 'Replace schedule' : 'Upload a schedule',
      intro: isHosted(feed)
        ? `The new zip becomes what this feed serves, and the one it is serving now stays in the
           history so you can go back to it.`
        : `Uploading a zip hosts this feed here: it stops being downloaded from
           ${feed.static_feed_url ?? 'its URL'} and is served at its own permanent URL instead.`,
      submitLabel: 'Upload',
      fields: [scheduleZipField({ autofocus: true })],
      validate: (values): Record<string, string> | null =>
        values.file ? null : { file: 'Choose a schedule zip to upload' },
      submit: (_values, files) => putSchedule(feed.id, files.file!),
    });
    if (!uploaded) return;

    notify.success(`Uploaded ${uploaded.original_filename} (${formatBytes(uploaded.size_bytes)})`);
    await this.app.refreshFeed();
    await this.app.refreshUploads();
    // Both halves re-read the new zip: the server has been asked to, and this
    // browser draws from its own copy.
    this.app.reloadScheduled();
  }

  /** The public URL of the schedule, for pasting into whatever consumes it. */
  private async copyScheduleUrl(): Promise<void> {
    const feed = this.feedOrWarn();
    if (!feed) return;
    const url = publicScheduleUrl(feed);
    if (!url) {
      notify.warning('This feed has no schedule URL yet.');
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      notify.success('Copied the schedule URL');
    } catch {
      // Denied permission, or an insecure origin. The URL is on screen already.
      notify.warning('Could not copy. The URL is on the page, above this.');
    }
  }

  /** Roll the feed back to an earlier upload. A pointer move *and* a re-load. */
  private async activateSchedule(uploadId: string): Promise<void> {
    const feed = this.feedOrWarn();
    if (!feed) return;
    const upload = this.session.uploads?.find((u) => u.id === uploadId);
    if (!upload) return;

    const confirmed = await confirmAction({
      title: 'Serve this upload',
      question: `${upload.original_filename} becomes the schedule this feed serves.`,
      consequences: [
        'The server re-reads it, so the published realtime feed matches it within a minute or two',
        'The upload it is serving now stays in the history',
      ],
      confirmLabel: 'Serve it',
    });
    if (!confirmed) return;

    await activateUpload(feed.id, upload.id);
    notify.success(`Now serving ${upload.original_filename}`);
    await this.app.refreshFeed();
    await this.app.refreshUploads();
    this.app.reloadScheduled();
  }

  /** Forget one upload. The server refuses the one being served. */
  private async removeUpload(uploadId: string): Promise<void> {
    const feed = this.feedOrWarn();
    if (!feed) return;
    const upload = this.session.uploads?.find((u) => u.id === uploadId);
    if (!upload) return;

    const confirmed = await confirmAction({
      title: 'Delete this upload',
      question: `${upload.original_filename} is deleted from storage. It cannot be undone.`,
      consequences: ['You will not be able to roll back to it'],
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;

    await deleteUpload(feed.id, upload.id);
    notify.success(`Deleted ${upload.original_filename}`);
    await this.app.refreshUploads();
  }

  private async removeFeed(): Promise<void> {
    const feed = this.feedOrWarn();
    if (!feed) return;

    const trackers = this.session.trackers.size;
    const alerts = this.session.serviceAlerts.size;
    const confirmed = await confirmTyped({
      title: `Delete ${feed.feed_name}`,
      question: `This deletes the feed and everything on it. It cannot be undone.`,
      phrase: feed.feed_name,
      phraseLabel: 'feed name',
      consequences: [
        `${trackers} tracker${trackers === 1 ? '' : 's'} and their assignments go with it`,
        `${alerts} service alert${alerts === 1 ? '' : 's'} go with it`,
        'The published GTFS-RT URLs stop answering, and the name is free to be taken',
      ],
    });
    if (!confirmed) return;

    await deleteFeed(feed.id);
    notify.success(`Deleted ${feed.feed_name}`);
    this.app.clearFeed();
  }

  private async transferFeed(): Promise<void> {
    const feed = this.feedOrWarn();
    if (!feed) return;

    // Only a member can receive it, which is the server's rule too, so the
    // form offers exactly the managers who can be chosen rather than a free
    // field that would fail on save.
    const candidates = (this.session.members?.members ?? []).filter((m) => !m.is_owner);
    if (candidates.length === 0) {
      notify.warning('Add a manager before handing it over.');
      return;
    }

    const updated = await showEntityForm<Feed>({
      title: `Transfer ${feed.feed_name}`,
      intro:
        'The new owner can delete the feed and add or remove managers. You stay on as a manager.',
      submitLabel: 'Transfer',
      fields: [
        {
          name: 'new_owner_id',
          label: 'New owner',
          type: 'select',
          value: String(candidates[0].user_id),
          options: candidates.map((m) => ({
            value: String(m.user_id),
            label: personLabel(m),
          })),
          autofocus: true,
        },
      ],
      submit: (values) => transferFeed(feed.id, Number(values.new_owner_id)),
    });
    if (!updated) return;

    this.app.adoptFeedRow(updated);
    await this.app.refreshMembers();
    notify.success(`${feed.feed_name} now belongs to ${updated.owner_name ?? 'them'}`);
  }

  // ─── Trackers ──────────────────────────────────────────────────────────────

  private async newTracker(): Promise<void> {
    const feed = this.feedOrWarn();
    if (!feed) return;

    const created = await showEntityForm<TrackerDetail>({
      title: 'New tracker',
      conflictField: 'nickname',
      fields: [
        {
          name: 'nickname',
          label: 'Nickname',
          autofocus: true,
          tooltip: 'The label the map and the public feed show. Unique within this feed.',
        },
        {
          name: 'device_key',
          label: 'Device key',
          placeholder: 'generated for you',
          tooltip: 'The Traccar credential. Settable now and never again, so leave it blank unless you are matching an existing device.',
        },
      ],
      submit: (values) => {
        const device_key = orNull(values.device_key);
        return createTracker(feed.id, {
          nickname: values.nickname.trim(),
          ...(device_key ? { device_key } : {}),
        });
      },
    });
    if (!created) return;

    await this.app.refreshTrackers();
    // The create response is the detail form, so the credential is already in
    // hand: caching it here is what stops the tracker page fetching it again a
    // moment later. After the refresh, which replaces the summary map.
    this.session.setTrackerDetail(created);
    notify.success(`Created ${created.nickname}`);
    // Straight to its page: the next thing anybody does with a new tracker is
    // provision it, and the credential is served there.
    this.app.setFocus({ type: 'tracker', tracker_id: created.id });
  }

  private async editTracker(trackerId: string): Promise<void> {
    const tracker = this.session.trackers.get(trackerId);
    if (!tracker) return;

    const updated = await showEntityForm<Tracker>({
      title: `Rename ${tracker.nickname}`,
      intro:
        'The nickname is a label, not an address: links to this tracker keep working after a rename.',
      conflictField: 'nickname',
      fields: [
        { name: 'nickname', label: 'Nickname', value: tracker.nickname, autofocus: true },
      ],
      submit: (values) => updateTracker(tracker.id, { nickname: values.nickname.trim() }),
    });
    if (!updated) return;

    await this.app.refreshTrackers();
    notify.success(`Renamed to ${updated.nickname}`);
  }

  private async removeTracker(trackerId: string): Promise<void> {
    const tracker = this.session.trackers.get(trackerId);
    if (!tracker) return;

    const confirmed = await confirmTyped({
      title: `Delete ${tracker.nickname}`,
      question: 'This deletes the tracker and stops its device reporting.',
      phrase: tracker.nickname,
      phraseLabel: 'nickname',
      consequences: [
        'Its assignment rules are deleted with it',
        'Its Traccar device is retired, so the credential stops working',
      ],
    });
    if (!confirmed) return;

    await deleteTracker(tracker.id);
    await this.app.refreshTrackers();
    notify.success(`Deleted ${tracker.nickname}`);
    // The page it was on is gone; anything else would render "not found".
    if (this.app.focus.type === 'tracker' && this.app.focus.tracker_id === tracker.id) {
      this.app.clearFocus();
    }
  }

  /**
   * The provisioning dialog: the config URL and its QR.
   *
   * Everything in it encodes `device_key`, the QR included, so it is opened
   * deliberately and is never part of a page's default render. The SVG is
   * inserted as markup because it *is* markup: cafe-car builds it from the
   * config URL alone, and a QR carries no text nodes to smuggle anything in.
   */
  private async showProvisioning(trackerId: string): Promise<void> {
    const tracker = this.session.trackers.get(trackerId);
    if (!tracker) return;

    const provisioning = await getProvisioning(trackerId);
    await showModal({
      title: escHtml(`Provision ${tracker.nickname}`),
      body: `
        <div class="space-y-3">
          <p class="text-xs opacity-70">Scan this with the Traccar Client app, or paste the link
          into it. Anyone who has either can post positions as this tracker.</p>
          <div class="bg-white rounded-lg p-3 flex justify-center [&>svg]:h-48 [&>svg]:w-48">
            ${provisioning.qr_svg}
          </div>
          <label class="fieldset">
            <span class="label">Configuration link</span>
            <input class="input input-bordered w-full font-mono text-xs" readonly
                   value="${escHtml(provisioning.config_url)}" />
          </label>
          <a class="btn btn-sm btn-outline w-full" href="${escHtml(provisioning.config_url)}">
            Open in Traccar Client
          </a>
          <label class="fieldset">
            <span class="label">${tooltipLabelContent(
              'Device key',
              'Type this in by hand if the QR flow fails.'
            )}</span>
            <input class="input input-bordered w-full font-mono text-xs" readonly
                   value="${escHtml(provisioning.device_key)}" />
          </label>
        </div>`,
      actions: [{ label: 'Close', onClick: () => {} }],
      escapeAction: 0,
      boxClassName: 'max-w-md',
    });
  }

  // ─── Alerts ────────────────────────────────────────────────────────────────

  /** The alert form, shared by create and edit: the same fields either way. */
  private alertFields(alert: Alert | null): FormField[] {
    return [
      {
        name: 'header_text',
        label: 'Header',
        spec: { message: 'Alert', field: 'header_text' },
        value: alert?.header_text ?? '',
        autofocus: true,
        tooltip: 'The one line a rider sees. Shown in every consumer of this feed.',
      },
      {
        name: 'description_text',
        label: 'Description',
        spec: { message: 'Alert', field: 'description_text' },
        type: 'textarea',
        value: alert?.description_text ?? '',
      },
      {
        name: 'url',
        label: 'More information URL',
        spec: { message: 'Alert', field: 'url' },
        type: 'url',
        value: alert?.url ?? '',
      },
      {
        name: 'cause',
        label: 'Cause',
        spec: { message: 'Alert', field: 'cause' },
        type: 'select',
        value: alert?.cause ?? '',
        options: enumOptions(ALERT_CAUSES, 'Cause'),
      },
      {
        name: 'effect',
        label: 'Effect',
        spec: { message: 'Alert', field: 'effect' },
        type: 'select',
        value: alert?.effect ?? '',
        options: enumOptions(ALERT_EFFECTS, 'Effect'),
      },
      {
        name: 'severity_level',
        label: 'Severity',
        spec: { message: 'Alert', field: 'severity_level' },
        type: 'select',
        value: alert?.severity_level ?? '',
        options: enumOptions(ALERT_SEVERITIES, 'SeverityLevel'),
      },
      // The two halves of the alert's one `active_period`, which is why these
      // name TimeRange rather than Alert: the API flattens the repeated field
      // to a single range, and the reference's prose about `start` and `end`
      // is what a person filling these in needs.
      {
        name: 'active_period_start',
        label: 'Active from',
        spec: { message: 'TimeRange', field: 'start' },
        type: 'datetime',
        value: toLocalInput(alert?.active_period_start),
        tooltip: 'In your own timezone. Leave both blank to publish it for as long as it exists.',
      },
      {
        name: 'active_period_end',
        label: 'Active until',
        spec: { message: 'TimeRange', field: 'end' },
        type: 'datetime',
        value: toLocalInput(alert?.active_period_end),
      },
    ];
  }

  /**
   * The two ends of the active period, before the write.
   *
   * The date half of a `datetime` is a typeable box, so an unreadable window
   * would otherwise reach `fromLocalInput`, come back null, and publish the
   * alert with no window at all.
   */
  private validateAlert(values: Record<string, string>): Record<string, string> | null {
    const errors: Record<string, string> = {};
    for (const name of ['active_period_start', 'active_period_end']) {
      if (values[name].trim() && fromLocalInput(values[name]) === null) {
        errors[name] = 'A date as YYYY-MM-DD, and a time';
      }
    }
    return Object.keys(errors).length ? errors : null;
  }

  /** The form's values as the API's body. Every field is sent on every save. */
  private alertBody(values: Record<string, string>): AlertWrite {
    return {
      header_text: values.header_text.trim(),
      description_text: values.description_text.trim(),
      url: orNull(values.url),
      cause: orNull(values.cause),
      effect: orNull(values.effect),
      severity_level: orNull(values.severity_level),
      active_period_start: fromLocalInput(values.active_period_start),
      active_period_end: fromLocalInput(values.active_period_end),
    };
  }

  private async newAlert(): Promise<void> {
    const feed = this.feedOrWarn();
    if (!feed) return;

    const created = await showEntityForm<Alert>({
      title: 'New service alert',
      intro:
        'It applies to the whole feed until you add informed entities naming a route, stop or trip.',
      submitLabel: 'Publish',
      fields: this.alertFields(null),
      validate: (values) => this.validateAlert(values),
      submit: (values) => createAlert(feed.id, this.alertBody(values)),
    });
    if (!created) return;

    await this.app.refreshServiceAlerts();
    notify.success('Published the alert');
    this.app.setFocus({ type: 'alert', alert_id: String(created.id) });
  }

  private async editAlert(alertId: string): Promise<void> {
    const alert = this.session.serviceAlerts.get(alertId);
    if (!alert) return;

    const updated = await showEntityForm<Alert>({
      title: 'Edit alert',
      fields: this.alertFields(alert),
      validate: (values) => this.validateAlert(values),
      submit: (values) => updateAlert(alert.id, this.alertBody(values)),
    });
    if (!updated) return;

    await this.app.refreshServiceAlerts();
    notify.success('Saved the alert');
  }

  private async removeAlert(alertId: string): Promise<void> {
    const alert = this.session.serviceAlerts.get(alertId);
    if (!alert) return;

    const confirmed = await confirmAction({
      title: 'Delete alert',
      question: `Delete "${alert.header_text}"? Consumers of this feed stop seeing it.`,
      consequences: alert.entity_count
        ? [
            `Its ${alert.entity_count} informed entit${
              alert.entity_count === 1 ? 'y' : 'ies'
            } go with it`,
          ]
        : [],
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;

    await deleteAlert(alert.id);
    await this.app.refreshServiceAlerts();
    notify.success('Deleted the alert');
    if (this.app.focus.type === 'alert' && this.app.focus.alert_id === alertId) {
      this.app.clearFocus();
    }
  }

  /**
   * The informed-entity form's fields, every one of them a real EntitySelector
   * or TripDescriptor field.
   *
   * The ids are combos over the schedule this browser has parsed rather than
   * text boxes, because a mistyped `stop_id` is an alert that silently informs
   * nobody. Free text is still accepted throughout: the zip may be stale or
   * absent, and the server does not check an id against it either.
   */
  private entityFields(): FormField[] {
    const feed = this.session.scheduledFeed;
    const routes = routeOptions(feed);
    const directions = directionOptions(feed);
    return [
      {
        name: 'agency_id',
        label: 'Agency id',
        spec: { message: 'EntitySelector', field: 'agency_id' },
        type: 'combo',
        options: agencyOptions(feed),
        comboEmpty: NO_SCHEDULE,
        autofocus: true,
      },
      {
        name: 'route_id',
        label: 'Route id',
        spec: { message: 'EntitySelector', field: 'route_id' },
        type: 'combo',
        options: routes,
        comboEmpty: NO_SCHEDULE,
      },
      {
        name: 'route_type',
        label: 'Route type',
        spec: { message: 'EntitySelector', field: 'route_type' },
        type: 'combo',
        options: routeTypeOptions(feed),
        comboEmpty: NO_SCHEDULE,
      },
      {
        name: 'direction_id',
        label: 'Direction id',
        spec: { message: 'EntitySelector', field: 'direction_id' },
        type: 'combo',
        options: directions,
        comboEmpty: NO_SCHEDULE,
        tooltip: 'Only means something alongside a route id.',
      },
      {
        name: 'stop_id',
        label: 'Stop id',
        spec: { message: 'EntitySelector', field: 'stop_id' },
        type: 'combo',
        options: stopOptions(feed),
        comboEmpty: NO_SCHEDULE,
      },
      {
        name: 'trip_id',
        label: 'Trip id',
        spec: { message: 'TripDescriptor', field: 'trip_id' },
        // The whole feed, because an alert can name any trip in it. The combo
        // caps what it lists and matches the id as well as the label, so a
        // feed of fifty thousand trips is typed at rather than scrolled.
        type: 'combo',
        options: tripOptions(feed),
        comboEmpty: NO_SCHEDULE,
      },
      {
        name: 'trip_route_id',
        label: 'Trip route id',
        spec: { message: 'TripDescriptor', field: 'route_id' },
        type: 'combo',
        options: routes,
        comboEmpty: NO_SCHEDULE,
      },
      {
        name: 'trip_direction_id',
        label: 'Trip direction id',
        spec: { message: 'TripDescriptor', field: 'direction_id' },
        type: 'combo',
        options: directions,
        comboEmpty: NO_SCHEDULE,
      },
      {
        name: 'trip_start_time',
        label: 'Trip start time',
        spec: { message: 'TripDescriptor', field: 'start_time' },
        placeholder: 'HH:MM:SS',
      },
      {
        name: 'trip_start_date',
        label: 'Trip start date',
        spec: { message: 'TripDescriptor', field: 'start_date' },
        placeholder: 'YYYYMMDD',
      },
    ];
  }

  private async addEntity(alertId: string): Promise<void> {
    const alert = this.session.serviceAlerts.get(alertId);
    if (!alert) return;

    const created = await showEntityForm({
      title: 'Add informed entity',
      intro:
        'Name at least one of agency, route, route type, stop or trip. Nothing here is checked against the schedule: an id can be published before the zip carrying it is loaded.',
      submitLabel: 'Add',
      fields: this.entityFields(),
      submit: (values) => {
        const body: InformedEntityWrite = {
          agency_id: orNull(values.agency_id),
          route_id: orNull(values.route_id),
          route_type: orNullNumber(values.route_type),
          direction_id: orNullNumber(values.direction_id),
          stop_id: orNull(values.stop_id),
          trip_id: orNull(values.trip_id),
          trip_route_id: orNull(values.trip_route_id),
          trip_direction_id: orNullNumber(values.trip_direction_id),
          trip_start_time: orNull(values.trip_start_time),
          trip_start_date: orNull(values.trip_start_date),
        };
        return createEntity(alert.id, body);
      },
    });
    if (!created) return;

    await this.refreshAlertDetail(alert.id);
    notify.success('Added the entity');
  }

  private async removeEntity(arg: string): Promise<void> {
    // `alertId:entityId`: an entity is only addressable through its own alert,
    // which is how the server scopes the delete too.
    const [alertId, entityId] = arg.split(':');
    const alert = this.session.serviceAlerts.get(alertId);
    if (!alert) return;

    const confirmed = await confirmAction({
      title: 'Remove informed entity',
      question: 'Remove this entity from the alert?',
      consequences: ['The alert stays, and applies to the whole feed if this was its last entity'],
    });
    if (!confirmed) return;

    await deleteEntity(alert.id, Number(entityId));
    await this.refreshAlertDetail(alert.id);
    notify.success('Removed the entity');
  }

  /**
   * Re-read one alert's detail after its entities changed.
   *
   * The list endpoint carries a count and no entities, so the detail is the
   * only thing that can answer, and the count in the tree comes from the list.
   * Both, therefore.
   */
  private async refreshAlertDetail(alertId: number): Promise<void> {
    this.session.setAlertDetail(await getAlert(alertId));
    await this.app.refreshServiceAlerts();
  }

  // ─── Assignments ───────────────────────────────────────────────────────────

  /**
   * The route an assignment form is about, or null for the whole feed.
   *
   * A form opened from a trip page or for a chosen trip is about that trip's
   * route; one opened from a route page is about that route. Anywhere else
   * there is no route in hand and the trip list falls back to what the feed
   * already assigns.
   */
  private assignScopeRoute(tripId: string | null): string | null {
    const feed = this.session.scheduledFeed;
    if (tripId) return feed?.trips.get(tripId)?.route_id ?? null;
    const focus = this.app.focus;
    if (focus.type === 'route') return focus.route_id;
    if (focus.type === 'trip') {
      return focus.route_id ?? feed?.trips.get(focus.trip_id)?.route_id ?? null;
    }
    return null;
  }

  /**
   * The Trip field: a select of the trips worth offering, or a combo when
   * there are too many of them to put in a dropdown.
   *
   * The trip already named is always in the list, even when the scope does not
   * reach it \u2014 an edit must open on what it is about to change, and a feed
   * reloaded under a rule can lose the trip entirely.
   */
  private tripField(routeId: string | null, tripId: string): FormField {
    const feed = this.session.scheduledFeed;
    const options = tripOptions(feed, assignableTrips(this.session, routeId));
    if (tripId && !options.some((o) => o.value === tripId)) {
      const trip = feed?.trips.get(tripId);
      options.unshift({
        value: tripId,
        label: trip && feed ? tripLabel(feed, trip) : tripId,
        detail: tripId,
      });
    }
    const base = {
      name: 'trip_id',
      label: 'Trip',
      value: tripId,
    };
    if (options.length && options.length <= CONFIG.TRIP_SELECT_MAX) {
      return { ...base, type: 'select', options };
    }
    // Too many to list, or no schedule at all: the combo filters as it is
    // typed into and takes an id typed by hand either way.
    return { ...base, type: 'combo', options: tripOptions(feed), comboEmpty: NO_SCHEDULE };
  }

  /**
   * The rule form, shared by create and edit.
   *
   * The times are service-day clock readings, so 23:00 to 25:10 is how an
   * overnight run is written and there is no "next day" checkbox inventing a
   * second way to say the same number.
   *
   * `Repeats` is `Once` or `Weekly`. A one-off writes every weekday false,
   * which is what `ruleBody` has always written for it; the radio just says so
   * up front instead of leaving it to be read off an empty set of day pills.
   */
  private ruleFields(
    rule: TrackerRule | null,
    tripId: string,
    startDate: string,
    scopeRoute: string | null
  ): FormField[] {
    return [
      this.tripField(scopeRoute, rule?.trip_id ?? tripId),
      {
        name: 'repeats',
        label: 'Repeats',
        type: 'radio',
        value: rule ? (ruleIsOneOff(rule) ? 'once' : 'weekly') : 'weekly',
        options: [
          { value: 'once', label: 'Once' },
          { value: 'weekly', label: 'Weekly' },
        ],
      },
      {
        name: 'weekdays',
        label: 'Runs on',
        type: 'weekdays',
        value: weekdayValue(
          WEEKDAY_KEYS.map((key) => (rule ? Boolean(rule[key]) : key === weekdayKey(startDate)))
        ),
        visibleWhen: { field: 'repeats', equals: 'weekly' },
      },
      {
        name: 'start_date',
        label: 'Starting',
        type: 'date',
        value: rule?.start_date ?? startDate,
        tooltip: 'In the feed\u2019s timezone, not yours.',
        labelWhen: { field: 'repeats', equals: 'once', label: 'On' },
      },
      {
        name: 'end_date',
        label: 'Until',
        type: 'date',
        value: rule?.end_date ?? '',
        visibleWhen: { field: 'repeats', equals: 'weekly' },
      },
      {
        name: 'start_time',
        label: 'Starts',
        value: rule ? ruleTimeInput(rule.start_time) : '',
        placeholder: 'HH:MM',
      },
      {
        name: 'end_time',
        label: 'Ends',
        value: rule ? ruleTimeInput(rule.end_time) : '',
        placeholder: 'HH:MM, or 25:10 for the small hours',
        tooltip: 'Past midnight keeps counting: a run ending at 01:10 the next morning is 25:10.',
      },
    ];
  }

  /** Everything the form cannot express as a field, checked before the write. */
  private validateRule(values: Record<string, string>): Record<string, string> | null {
    const errors: Record<string, string> = {};
    if (!values.trip_id.trim()) errors.trip_id = 'A rule needs a trip';
    // The date boxes are typeable, so the shape is this form's to check: the
    // month grid can only produce a service date, but a person can type
    // anything into the box it fills in.
    const startDate = values.start_date.trim();
    const endDate = values.end_date.trim();
    if (!startDate) errors.start_date = 'A rule needs a first service date';
    else if (!isServiceDate(startDate)) errors.start_date = 'A date as YYYY-MM-DD';
    if (endDate && !isServiceDate(endDate)) errors.end_date = 'A date as YYYY-MM-DD';
    const start_time = parseRuleTime(values.start_time);
    const end_time = parseRuleTime(values.end_time);
    if (start_time === null) errors.start_time = 'A clock time as HH:MM';
    if (end_time === null) errors.end_time = 'A clock time as HH:MM';
    if (start_time !== null && end_time !== null && end_time <= start_time) {
      errors.end_time = 'The window ends before it starts';
    }
    // `Once` is where a rule with no weekday now belongs; `Weekly` with none
    // picked is a rule that never runs.
    if (values.repeats === 'weekly' && !weekdayBits(values.weekdays).some(Boolean)) {
      errors.weekdays = 'Pick at least one day, or choose Once';
    }
    return Object.keys(errors).length ? errors : null;
  }

  /**
   * The form's values as a rule body.
   *
   * A one-off is every weekday false with the start date as the whole range;
   * the date it actually runs on is written afterwards, as an `added`
   * exception. That is the model's own way of saying "just this day", and it
   * means a one-off and a skipped recurrence are the same kind of object.
   */
  private ruleBody(values: Record<string, string>): RuleWrite {
    const once = isOneOff(values);
    const days = once ? [false, false, false, false, false, false, false] : weekdayBits(values.weekdays);
    const startDate = values.start_date.trim();
    const endDate = values.end_date.trim();
    return {
      trip_id: values.trip_id.trim(),
      monday: days[0],
      tuesday: days[1],
      wednesday: days[2],
      thursday: days[3],
      friday: days[4],
      saturday: days[5],
      sunday: days[6],
      start_date: startDate,
      end_date: once ? startDate : endDate || null,
      start_time: parseRuleTime(values.start_time)!,
      end_time: parseRuleTime(values.end_time)!,
    };
  }

  /**
   * A trip's own schedule as the default window.
   *
   * A rule's window is what decides whether a fix belongs to this trip, so the
   * trip's first departure to its last arrival is very nearly always the
   * answer. GTFS clock values past 24:00 come through untouched, which is
   * exactly what the column wants.
   */
  private tripWindow(tripId: string): { start: string; end: string } | null {
    const times = this.session.scheduledFeed?.stopTimesByTrip.get(tripId);
    if (!times || times.length === 0) return null;
    const start = parseGtfsClock(times[0].departure_time || times[0].arrival_time || undefined);
    const last = times[times.length - 1];
    const end = parseGtfsClock(last.arrival_time || last.departure_time || undefined);
    if (start === null || end === null || end <= start) return null;
    return { start: ruleTimeInput(start), end: ruleTimeInput(end) };
  }

  /**
   * Create an assignment. `arg` is the service date the calendar was on, or a
   * trip id when the ask came from a trip page.
   */
  async newAssignment(arg: string, presetTrip: string | null = null): Promise<void> {
    const feed = this.feedOrWarn();
    if (!feed) return;

    const trackers = [...this.session.trackers.values()].sort((a, b) =>
      a.nickname.localeCompare(b.nickname)
    );
    if (trackers.length === 0) {
      notify.warning('Create a tracker before assigning one.');
      return;
    }

    const startDate = isServiceDate(arg) ? arg : today();
    // The trip is settled when the ask came from a trip page and open
    // otherwise; either way it is a field of this form rather than a dialog in
    // front of it.
    const tripId = presetTrip ?? '';
    const scopeRoute = this.assignScopeRoute(presetTrip);

    const trip = tripId ? this.session.scheduledFeed?.trips.get(tripId) : undefined;
    const window = tripId ? this.tripWindow(tripId) : null;
    const fields = this.ruleFields(null, tripId, startDate, scopeRoute);
    // Prefilled from the trip's own schedule, which is what the window is
    // nearly always meant to be.
    if (window) {
      fields.find((f) => f.name === 'start_time')!.value = window.start;
      fields.find((f) => f.name === 'end_time')!.value = window.end;
    }

    const created = await showEntityForm<TrackerRule>({
      title: trip ? `Assign ${tripName(trip)}` : 'Assign a trip',
      intro:
        'A tracker reporting inside this window is running this trip, and the service date it started on is the trip\u2019s start_date in the published feed.',
      submitLabel: 'Assign',
      // Opened from a trip, every field is already prefilled from that trip and
      // the day that was clicked, so the common case is pressing Assign.
      allowPristine: true,
      fields: [
        {
          name: 'tracker_id',
          label: 'Tracker',
          type: 'select',
          value: trackers[0].id,
          options: trackers.map((t) => ({ value: t.id, label: t.nickname })),
          autofocus: true,
        },
        ...fields,
      ],
      validate: (values) => {
        const errors = this.validateRule(values) ?? {};
        // The select carries an empty first option, and a rule with no tracker
        // would be posted to a path with a hole in it.
        if (!values.tracker_id) errors.tracker_id = 'Pick a tracker';
        return Object.keys(errors).length ? errors : null;
      },
      submit: async (values) => {
        const rule = await createRule(values.tracker_id, this.ruleBody(values));
        // A one-off is a rule with no weekday, so the date it runs on is an
        // added exception. Written here rather than by the server, because the
        // server's job is to store a rule, not to guess what one means.
        if (isOneOff(values)) {
          await addRuleException(rule.id, {
            date: values.start_date.trim(),
            exception_type: 'added',
          });
        }
        return rule;
      },
    });
    if (!created) return;

    await this.app.refreshCalendar();
    notify.success('Assigned');
  }

  private async editAssignment(ruleId: string): Promise<void> {
    const rule = this.session.rules?.get(Number(ruleId));
    if (!rule) return;
    const tracker = this.session.trackers.get(rule.tracker_id);

    const updated = await showEntityForm<TrackerRule>({
      title: tracker ? `Edit ${tracker.nickname}\u2019s assignment` : 'Edit assignment',
      intro:
        'Changing when a rule runs leaves its per-day exceptions alone: they name dates, and "not on the 4th" survives a change of weekday.',
      fields: this.ruleFields(
        rule,
        rule.trip_id,
        rule.start_date,
        this.assignScopeRoute(rule.trip_id)
      ),
      validate: (values) => this.validateRule(values),
      submit: async (values) => {
        const body = this.ruleBody(values);
        const saved = await updateRule(rule.id, body);
        // A rule edited down to a one-off needs the date it now runs on, and
        // the server keeps the exceptions, so writing the same one twice is a
        // no-op rather than a duplicate.
        if (isOneOff(values)) {
          await addRuleException(rule.id, {
            date: body.start_date,
            exception_type: 'added',
          });
        } else if (ruleIsOneOff(rule)) {
          // Flipped the other way: drop the exception the one-off wrote on
          // its start date, or a rule that is `Weekly` now keeps running a
          // day that stray exception added.
          const stray = rule.exceptions.find(
            (e) => e.date === rule.start_date && e.exception_type === 'added'
          );
          if (stray) await deleteRuleException(rule.id, stray.id);
        }
        return saved;
      },
    });
    if (!updated) return;

    await this.app.refreshCalendar();
    notify.success('Saved the assignment');
  }

  private async removeAssignment(ruleId: string): Promise<void> {
    const rule = this.session.rules?.get(Number(ruleId));
    if (!rule) return;
    const tracker = this.session.trackers.get(rule.tracker_id);

    const confirmed = await confirmAction({
      title: 'Delete assignment',
      question: `Stop ${tracker?.nickname ?? 'this tracker'} running ${rule.trip_id}?`,
      consequences: [
        'Every day it covers goes with it, past and future',
        'A fix arriving inside its window stops resolving to that trip',
      ],
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;

    await deleteRule(rule.id);
    await this.app.refreshCalendar();
    notify.success('Deleted the assignment');
  }

  /**
   * Make one day differ from the recurrence: skip it, or run on it after all.
   *
   * `arg` is `ruleId:date`. Writing a date the rule already has an exception
   * for replaces it, so the two directions are the same call and neither has
   * to delete first.
   */
  private async exceptOneDay(arg: string, type: 'added' | 'removed'): Promise<void> {
    const [ruleId, date] = arg.split(':');
    const rule = this.session.rules?.get(Number(ruleId));
    if (!rule || !isServiceDate(date)) return;

    await addRuleException(rule.id, { date, exception_type: type });
    await this.app.refreshCalendar();
    notify.success(type === 'removed' ? `Skipping ${date}` : `Running on ${date}`);
  }

  /** Drop a date's exception, putting it back under the weekday flags. */
  private async undoException(arg: string): Promise<void> {
    const [ruleId, date] = arg.split(':');
    const rule = this.session.rules?.get(Number(ruleId));
    const exception = rule?.exceptions.find((e) => e.date === date);
    if (!rule || !exception) return;

    await deleteRuleException(rule.id, exception.id);
    await this.app.refreshCalendar();
    notify.success(`${date} follows the rule again`);
  }

  /**
   * The three writes one cell of the assignments chart can take.
   *
   * A cell is one trip on one date, and the model says exactly three things can
   * be done to it: change the rule, which changes every week; remove this date,
   * which skips one day; add this date, which runs one day. A fourth entry
   * creates a rule where there is none, because an empty cell has nothing to
   * except.
   *
   * "Every other week" is deliberately not offered. `TrackerRule` cannot say it,
   * and a control that silently wrote forty exception rows would be lying about
   * what was stored.
   *
   * `arg` is `date:trip_id`. The date is first and ten characters wide because a
   * `trip_id` may itself contain a colon.
   */
  private async editOneDay(arg: string): Promise<void> {
    const date = arg.slice(0, 10);
    const tripId = arg.slice(11);
    if (!isServiceDate(date) || !tripId) return;

    const rules = [...(this.session.rules?.values() ?? [])].filter(
      (rule) => rule.trip_id === tripId
    );
    const runningIds = new Set(
      this.session.assignmentsOn(date)
        .filter((a) => a.trip_id === tripId)
        .map((a) => a.rule_id)
    );

    const trip = this.session.scheduledFeed?.trips.get(tripId);
    const choices: MenuChoice[] = [];

    for (const rule of rules) {
      const nickname = this.session.trackers.get(rule.tracker_id)?.nickname ?? rule.tracker_id;
      const exception = rule.exceptions.find((e) => e.date === date);
      const running = runningIds.has(rule.id);

      if (exception) {
        // The date already differs from the recurrence, so the write that
        // matters is putting it back rather than excepting it twice.
        choices.push({
          label: running ? `Stop running ${nickname} on this date` : `Un-skip ${nickname}`,
          detail: 'Drops the exception, so this date follows the rule again.',
          run: () => this.undoException(`${rule.id}:${date}`),
        });
      } else if (running) {
        choices.push({
          label: `Skip ${nickname} on this date`,
          detail: 'One removed exception. Every other date the rule covers is untouched.',
          run: () => this.exceptOneDay(`${rule.id}:${date}`, 'removed'),
        });
      } else {
        choices.push({
          label: `Run ${nickname} on this date`,
          detail: 'One added exception. The rule\u2019s weekdays are untouched.',
          run: () => this.exceptOneDay(`${rule.id}:${date}`, 'added'),
        });
      }

      choices.push({
        label: `Edit ${nickname}\u2019s rule\u2026`,
        detail: `${describeRecurrence(rule)} \u00b7 ${formatWindow(rule.start_time, rule.end_time)}. Changing it changes every week.`,
        run: () => this.editAssignment(String(rule.id)),
      });
    }

    choices.push({
      label: 'Assign a tracker to this trip\u2026',
      detail: 'A new rule, starting on this date.',
      className: 'btn-primary',
      run: () => this.newAssignment(date, tripId),
    });

    await this.chooseAndRun(
      trip ? `${tripName(trip)} on ${dayLabel(date)}` : `${tripId} on ${dayLabel(date)}`,
      choices
    );
  }

  /**
   * A modal of one-line choices, run after it closes.
   *
   * The buttons are in the body rather than the action bar: there are as many
   * as the cell has rules, each carries a sentence saying what it writes, and
   * `showModal`'s footer is for confirm/cancel.
   */
  private async chooseAndRun(title: string, choices: MenuChoice[]): Promise<void> {
    // A holder rather than a bare `let`: the assignment happens inside the
    // mount handler, which the compiler's flow analysis does not follow.
    const picked: { choice?: MenuChoice } = {};

    await showModal({
      title: escHtml(title),
      body: `<ul class="space-y-2">${choices
        .map(
          (choice, i) => `<li>
            <button type="button" data-choice="${i}"
              class="btn btn-sm btn-block justify-start text-left ${choice.className ?? 'btn-outline'}">
              ${escHtml(choice.label)}
            </button>
            <p class="text-xs opacity-60 mt-1">${escHtml(choice.detail)}</p>
          </li>`
        )
        .join('')}</ul>`,
      actions: [{ label: 'Cancel', onClick: () => {} }],
      escapeAction: 0,
      boxClassName: 'max-w-md',
      onMount: (close) => {
        const boxes = document.querySelectorAll<HTMLElement>('.modal-open .modal-box');
        const box = boxes[boxes.length - 1];
        box.addEventListener('click', (event) => {
          const button = (event.target as HTMLElement | null)?.closest<HTMLElement>(
            '[data-choice]'
          );
          if (!button) return;
          picked.choice = choices[Number(button.dataset.choice)];
          close();
        });
      },
    });

    // Run after the modal is gone, so a choice that opens its own dialog does
    // not stack one on top of another.
    await picked.choice?.run();
  }

  // ─── Managers ──────────────────────────────────────────────────────────────

  private async addManager(): Promise<void> {
    const feed = this.feedOrWarn();
    if (!feed) return;

    const result = await showEntityForm({
      title: 'Add manager',
      intro:
        'They get access once they sign in with a verified copy of this address. Nothing is emailed from here.',
      submitLabel: 'Add',
      fields: [
        {
          name: 'email',
          label: 'Email address',
          autofocus: true,
          tooltip: 'Matched against verified addresses only.',
        },
      ],
      submit: (values) => addMember(feed.id, values.email.trim()),
    });
    if (!result) return;

    await this.app.refreshMembers();
    // The server's own wording: "manager now" and "invited for later" are
    // genuinely different outcomes and it says which one happened.
    notify.success(result.message);
  }

  private async removeManager(userId: string): Promise<void> {
    const feed = this.feedOrWarn();
    if (!feed) return;
    const member = this.session.members?.members.find((m) => m.user_id === Number(userId));
    if (!member) return;

    const confirmed = await confirmAction({
      title: 'Remove manager',
      question: `Take ${personLabel(member)} off ${feed.feed_name}?`,
      consequences: ['Anything they made on this feed stays'],
    });
    if (!confirmed) return;

    await removeMember(feed.id, member.user_id);
    await this.app.refreshMembers();
    notify.success(`Removed ${personLabel(member)}`);
  }

  private async revokePendingInvite(inviteId: string): Promise<void> {
    const feed = this.feedOrWarn();
    if (!feed) return;
    const invite = this.session.members?.invites.find((i) => i.id === Number(inviteId));
    if (!invite) return;

    const confirmed = await confirmAction({
      title: 'Revoke invite',
      question: `Withdraw the invite to ${invite.email}?`,
      consequences: ['They get nothing if they sign in later'],
      confirmLabel: 'Revoke',
    });
    if (!confirmed) return;

    await revokeInvite(feed.id, invite.id);
    await this.app.refreshMembers();
    notify.success(`Revoked the invite to ${invite.email}`);
  }
}
