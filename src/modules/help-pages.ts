/* @vendored-from test-track:src/modules/help-pages.ts
   @sha bf5cc8c
   @status modified
   @changes
   - HELP_PAGES is [aboutPage] only: this app has no welcome or map-key page.
   - `AboutApp` is yard-master's own, carried over from the old
     `about-modal.ts`: it says plainly that an uploaded schedule is stored and
     published, and names viz.rt.gtfs.zone as the sibling app.
   - Project and Resources are rendered locally rather than through
     `renderProjectSection`/`renderResourcesSection` from `about-links.ts`. The
     shared Project block always links manage.rt.gtfs.zone, which would link
     this app to itself; the local one names both sibling apps instead. The
     shared Resources block names TransitLand as the source behind a Load menu
     this app does not have, so the local one links the realtime reference
     this repo's spec is checked against. */
/**
 * The help page registry: what pages exist, their grouping, and their copy.
 *
 * Rendering lives in `help-modal.ts`. This module is data only.
 */

import {
  renderBlurb,
  renderVersionAndSource,
  renderFeedbackSection,
  type AboutApp,
} from './about-links';

export type HelpGroup = 'Getting Started' | 'Reference';

export interface HelpPage {
  id: string;
  label: string;
  group: HelpGroup;
  title: string;
  render(): string;
  /**
   * Marks a page that is auto-shown once at its trigger and afterwards only
   * reachable from the Guide menu. Pages without it are reference-only.
   */
  showOnce?: boolean;
}

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

const ABOUT_APP: AboutApp = {
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

/**
 * Version data isn't known when this module loads (it comes from
 * `__APP_VERSION__`), so `index.ts` pushes it in once during boot.
 */
let helpRuntimeData: { version: string } = { version: '' };

export function setHelpRuntimeData(data: { version: string }): void {
  helpRuntimeData = data;
}

const aboutPage: HelpPage = {
  id: 'about',
  label: 'About',
  group: 'Reference',
  title: 'About manage.rt.gtfs.zone',
  render: () =>
    [
      renderBlurb(ABOUT_APP),
      renderVersionAndSource(ABOUT_APP, helpRuntimeData.version),
      renderProjectSection(ABOUT_APP),
      renderResourcesSection(),
      renderFeedbackSection(ABOUT_APP),
    ].join('\n'),
};

export const HELP_PAGES: HelpPage[] = [aboutPage];

export function getHelpPage(id: string): HelpPage | undefined {
  return HELP_PAGES.find((page) => page.id === id);
}
