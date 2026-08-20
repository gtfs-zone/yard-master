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
  InformedEntityWrite,
  Tracker,
  TrackerDetail,
} from '../types/api';
import type { AppState } from './app-state';
import type { FeedSession } from './feed-session';
import {
  addMember,
  createAlert,
  createEntity,
  createTracker,
  createTrackers,
  deleteAlert,
  deleteEntity,
  deleteFeed,
  deleteTracker,
  getAlert,
  getProvisioning,
  removeMember,
  revokeInvite,
  SessionExpiredError,
  transferFeed,
  updateAlert,
  updateFeed,
  updateTracker,
} from './api-client';
import { confirmAction, confirmTyped } from './confirm';
import type { FormField } from './entity-form';
import { showEntityForm } from './entity-form';
import {
  ALERT_CAUSES,
  ALERT_EFFECTS,
  ALERT_SEVERITIES,
  enumLabel,
  fromLocalInput,
  personLabel,
  toLocalInput,
} from './managed-render';
import { showModal } from './modal-utils';
import { notify } from './notification-system';
import { escHtml } from './render-utils';

/** The empty option plus one per enumeration value, labelled for reading. */
function enumOptions(values: readonly string[]): { value: string; label: string }[] {
  return [
    { value: '', label: '—' },
    ...values.map((v) => ({ value: v, label: enumLabel(v) })),
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
        case 'tracker:new':
          return await this.newTracker();
        case 'tracker:bulk':
          return await this.newTrackers();
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
        case 'person:add':
          return await this.addPerson();
        case 'member:remove':
          return await this.removePerson(arg);
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
          help: 'Appears in every public GTFS-RT URL this feed serves, so renaming it moves them.',
        },
        {
          name: 'static_feed_url',
          label: 'Static feed URL',
          type: 'url',
          value: feed.static_feed_url,
          help: 'Changing it re-downloads the schedule, here and on the server.',
        },
      ],
      submit: (values) =>
        updateFeed(feed.id, {
          feed_name: values.feed_name.trim(),
          static_feed_url: values.static_feed_url.trim(),
        }),
    });
    if (!updated) return;

    const urlChanged = updated.static_feed_url !== feed.static_feed_url;
    // Owns the hash rewrite: `feed_name` is what a shareable link carries.
    this.app.adoptFeedRow(updated);
    notify.success(`Saved ${updated.feed_name}`);
    if (urlChanged) void this.session.loadStatic(updated.static_feed_url, updated.feed_name);
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
    // form offers exactly the people who can be chosen rather than a free
    // field that would fail on save.
    const candidates = (this.session.people?.members ?? []).filter((m) => !m.is_owner);
    if (candidates.length === 0) {
      notify.warning('Add somebody to this feed before handing it over.');
      return;
    }

    const updated = await showEntityForm<Feed>({
      title: `Transfer ${feed.feed_name}`,
      intro:
        'The new owner can delete the feed and manage its people. You stay on as a member.',
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
    await this.app.refreshPeople();
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
          help: 'The label the map and the public feed show. Unique within this feed.',
        },
        {
          name: 'device_key',
          label: 'Device key',
          placeholder: 'generated for you',
          help: 'The Traccar credential. Settable now and never again, so leave it blank unless you are matching an existing device.',
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

  private async newTrackers(): Promise<void> {
    const feed = this.feedOrWarn();
    if (!feed) return;

    const created = await showEntityForm<Tracker[]>({
      title: 'New trackers',
      intro: 'Numbering continues past whatever this feed already has under the prefix.',
      submitLabel: 'Create',
      fields: [
        {
          name: 'prefix',
          label: 'Prefix',
          placeholder: 'bus-',
          autofocus: true,
          help: 'Used exactly as typed: "bus-" gives bus-1, bus-2, bus-3.',
        },
        { name: 'count', label: 'How many', type: 'number', value: '10' },
      ],
      validate: (values) => {
        const count = Number(values.count);
        if (!Number.isInteger(count) || count < 1) {
          return { count: 'A whole number of trackers, at least one' };
        }
        return null;
      },
      submit: (values) =>
        createTrackers(feed.id, {
          prefix: values.prefix.trim(),
          count: Number(values.count),
        }),
    });
    if (!created) return;

    await this.app.refreshTrackers();
    notify.success(`Created ${created.length} tracker${created.length === 1 ? '' : 's'}`);
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
          <label class="form-control">
            <span class="label-text text-xs">Configuration link</span>
            <input class="input input-bordered input-sm w-full font-mono text-xs" readonly
                   value="${escHtml(provisioning.config_url)}" />
          </label>
          <a class="btn btn-sm btn-outline w-full" href="${escHtml(provisioning.config_url)}">
            Open in Traccar Client
          </a>
          <label class="form-control">
            <span class="label-text text-xs">Device key</span>
            <input class="input input-bordered input-sm w-full font-mono text-xs" readonly
                   value="${escHtml(provisioning.device_key)}" />
            <span class="label-text-alt opacity-50">Type this in by hand if the QR flow fails.</span>
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
        value: alert?.header_text ?? '',
        autofocus: true,
        help: 'The one line a rider sees. Shown in every consumer of this feed.',
      },
      {
        name: 'description_text',
        label: 'Description',
        type: 'textarea',
        value: alert?.description_text ?? '',
      },
      { name: 'url', label: 'More information URL', type: 'url', value: alert?.url ?? '' },
      {
        name: 'cause',
        label: 'Cause',
        type: 'select',
        value: alert?.cause ?? '',
        options: enumOptions(ALERT_CAUSES),
      },
      {
        name: 'effect',
        label: 'Effect',
        type: 'select',
        value: alert?.effect ?? '',
        options: enumOptions(ALERT_EFFECTS),
      },
      {
        name: 'severity_level',
        label: 'Severity',
        type: 'select',
        value: alert?.severity_level ?? '',
        options: enumOptions(ALERT_SEVERITIES),
      },
      {
        name: 'active_period_start',
        label: 'Active from',
        type: 'datetime',
        value: toLocalInput(alert?.active_period_start),
        help: 'In your own timezone. Leave both blank to publish it for as long as it exists.',
      },
      {
        name: 'active_period_end',
        label: 'Active until',
        type: 'datetime',
        value: toLocalInput(alert?.active_period_end),
      },
    ];
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

  private async addEntity(alertId: string): Promise<void> {
    const alert = this.session.serviceAlerts.get(alertId);
    if (!alert) return;

    const created = await showEntityForm({
      title: 'Add informed entity',
      intro:
        'Name at least one of agency, route, route type, stop or trip. Nothing here is checked against the schedule: an id can be published before the zip carrying it is loaded.',
      submitLabel: 'Add',
      fields: [
        { name: 'agency_id', label: 'Agency id', autofocus: true },
        { name: 'route_id', label: 'Route id' },
        { name: 'route_type', label: 'Route type', type: 'number' },
        {
          name: 'direction_id',
          label: 'Direction id',
          type: 'number',
          help: 'Only means something alongside a route id.',
        },
        { name: 'stop_id', label: 'Stop id' },
        { name: 'trip_id', label: 'Trip id' },
        { name: 'trip_route_id', label: 'Trip route id' },
        { name: 'trip_direction_id', label: 'Trip direction id', type: 'number' },
        { name: 'trip_start_time', label: 'Trip start time', placeholder: 'HH:MM:SS' },
        { name: 'trip_start_date', label: 'Trip start date', placeholder: 'YYYYMMDD' },
      ],
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

  // ─── People ────────────────────────────────────────────────────────────────

  private async addPerson(): Promise<void> {
    const feed = this.feedOrWarn();
    if (!feed) return;

    const result = await showEntityForm({
      title: 'Share this feed',
      intro:
        'They get access once they sign in with a verified copy of this address. Nothing is emailed from here.',
      submitLabel: 'Share',
      fields: [
        {
          name: 'email',
          label: 'Email address',
          autofocus: true,
          help: 'Matched against verified addresses only.',
        },
      ],
      submit: (values) => addMember(feed.id, values.email.trim()),
    });
    if (!result) return;

    await this.app.refreshPeople();
    // The server's own wording: "member now" and "invited for later" are
    // genuinely different outcomes and it says which one happened.
    notify.success(result.message);
  }

  private async removePerson(userId: string): Promise<void> {
    const feed = this.feedOrWarn();
    if (!feed) return;
    const member = this.session.people?.members.find((m) => m.user_id === Number(userId));
    if (!member) return;

    const confirmed = await confirmAction({
      title: 'Remove member',
      question: `Take ${personLabel(member)} off ${feed.feed_name}?`,
      consequences: ['Anything they made on this feed stays'],
    });
    if (!confirmed) return;

    await removeMember(feed.id, member.user_id);
    await this.app.refreshPeople();
    notify.success(`Removed ${personLabel(member)}`);
  }

  private async revokePendingInvite(inviteId: string): Promise<void> {
    const feed = this.feedOrWarn();
    if (!feed) return;
    const invite = this.session.people?.invites.find((i) => i.id === Number(inviteId));
    if (!invite) return;

    const confirmed = await confirmAction({
      title: 'Revoke invite',
      question: `Withdraw the invite to ${invite.email}?`,
      consequences: ['They get nothing if they sign in later'],
      confirmLabel: 'Revoke',
    });
    if (!confirmed) return;

    await revokeInvite(feed.id, invite.id);
    await this.app.refreshPeople();
    notify.success(`Revoked the invite to ${invite.email}`);
  }
}
