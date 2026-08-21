/* @vendored-from test-track:src/modules/about-modal.ts
   @sha 9656623
   @status modified
   @changes
   - `APP` describes yard-master: what it manages, and that an uploaded
     schedule is stored and published at a public URL.
   - The Project and Resources sections are rendered here rather than by
     `about-links`. The shared Project block always names manage.rt.gtfs.zone,
     which would link this app to itself; the local one names both sibling apps
     instead. The shared Resources block describes TransitLand as the source
     behind a Load menu this app does not have, so the local one links the
     realtime reference this repo's spec is checked against.
*/
import { showModal } from './modal-utils';
import {
  AboutApp,
  renderBlurb,
  renderFeedbackSection,
  renderVersionAndSource,
} from './about-links';

const APP: AboutApp = {
  name: 'manage.rt.gtfs.zone',
  blurb: [
    'manage.rt.gtfs.zone runs a GTFS Realtime feed: the schedule behind it, the trackers reporting positions, what each tracker is running today, and the alerts riders see.',
    'A feed here is published at rt.gtfs.zone for anybody to consume. What you set up on this map is what the world reads:',
  ],
  highlights: [
    'Feeds, with a schedule you link by URL or upload',
    'Trackers, and the trips they are assigned to',
    'Service alerts, written against the loaded schedule',
    'Managers, and who owns the feed',
  ],
  blurbFooter:
    'The schedule is parsed in your browser, so browsing a feed uploads nothing. Uploading a schedule is the exception and is the point of it: that zip is stored and served publicly at the permanent gtfs.zip URL of that feed.',
  contactSubject: 'manage.rt.gtfs.zone feedback',
  repo: 'yard-master',
  sibling: {
    name: 'viz.rt.gtfs.zone',
    href: 'https://viz.rt.gtfs.zone',
    note: 'watch a realtime feed on a live map',
  },
};

/** External anchor, matching the one `about-links` renders. */
function link(href: string, label: string): string {
  return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="link">${label}</a>`;
}

function section(label: string, items: string[]): string {
  return (
    `<div class="divider text-sm font-semibold opacity-60">${label}</div>` +
    `<ul class="list-none space-y-1 text-sm">${items.map((i) => `<li>${i}</li>`).join('')}</ul>`
  );
}

/** The Project block, with this app as the one that is not linked. */
function renderProjectSection(app: AboutApp): string {
  const items = [
    `${link('https://gtfs.zone', 'gtfs.zone')}: the project these tools belong to`,
    `${link(app.sibling.href, app.sibling.name)}: ${app.sibling.note}`,
    `${link('https://edit.gtfs.zone', 'edit.gtfs.zone')}: build and edit a GTFS schedule feed in the browser`,
  ];
  return section('Project', items);
}

/** The Resources block: the two specs a feed here is written against. */
function renderResourcesSection(): string {
  return section('Resources', [
    `${link('https://gtfs.org/documentation/schedule/reference/', 'GTFS Schedule Reference')}: the file format behind a schedule`,
    `${link('https://gtfs.org/documentation/realtime/reference/', 'GTFS Realtime Reference')}: the field reference behind every alert and trip update here`,
  ]);
}

export function showAboutModal(version: string): Promise<void> {
  const body = [
    renderBlurb(APP),
    renderVersionAndSource(APP, version),
    renderProjectSection(APP),
    renderResourcesSection(),
    renderFeedbackSection(APP),
  ].join('\n');

  return showModal({
    title: APP.name,
    body,
    actions: [{ label: 'Close', onClick: () => {} }],
    enterAction: 0,
    escapeAction: 0,
  });
}
