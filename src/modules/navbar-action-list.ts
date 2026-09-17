import { renderMoonIcon, renderNavIcon, renderSunIcon } from 'interlocking/modules/nav-icons';
import type { NavbarAction } from 'interlocking/modules/navbar-actions';

/**
 * This app's navbar action row.
 *
 * `navbar-actions.ts` is shared across apps and holds no list of its own; each
 * app supplies one. Element ids are the contract with the click wiring and the
 * badge writers in `src/index.ts`.
 */

/** Stroked outline glyph with no entry in the shared icon map. */
function renderLocalIcon(path: string, sizeClass = 'h-5 w-5'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="${sizeClass}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="${path}" /></svg>`;
}

const SHARE_PATH =
  'M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z';
const USER_PATH =
  'M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z';

export const NAVBAR_ACTIONS: NavbarAction[] = [
  {
    kind: 'icon',
    id: 'calendar-btn',
    // The month a feed runs, and who is covering it. The badge counts today's
    // assignments once they are loaded.
    label: 'Calendar',
    icon: renderNavIcon('calendar'),
    badgeId: 'calendar-count',
    badgeClass: 'badge-primary',
  },
  {
    kind: 'icon',
    id: 'share-btn',
    // Who manages this feed, and who has been invited.
    label: 'Share',
    icon: renderLocalIcon(SHARE_PATH),
  },
  {
    kind: 'icon',
    id: 'alerts-btn',
    // Every managed alert on this feed. The badge counts them.
    label: 'Service alerts',
    icon: renderNavIcon('alerts'),
    badgeId: 'alerts-badge',
    badgeClass: 'badge-error',
  },
  {
    kind: 'toggle',
    id: 'theme-toggle',
    label: 'Toggle theme',
    iconOn: renderSunIcon('swap-on h-5 w-5'),
    iconOff: renderMoonIcon('swap-off h-5 w-5'),
    inputClass: 'theme-controller',
    value: 'light',
  },
  {
    kind: 'icon',
    id: 'help-btn',
    label: 'Guide',
    icon: renderNavIcon('guide'),
  },
  {
    kind: 'labeled',
    id: 'user-btn',
    // The signed-in person, labelled with their own name or address at boot.
    // Starts hidden and opens the account modal, which holds the link out to
    // Keycloak's Account Console and sign-out.
    label: 'Account',
    labelId: 'user-label',
    icon: renderLocalIcon(USER_PATH, 'h-4 w-4'),
    btnClass: 'btn-ghost',
  },
  {
    kind: 'labeled',
    id: 'feed-switcher-btn',
    // Your feeds only, plus New feed. Last, and the only primary button, the
    // way [Load] is in the upstreams.
    label: 'Select feed',
    labelId: 'feed-switcher-label',
    icon: renderNavIcon('load', { sizeClass: 'h-4 w-4' }),
    btnClass: 'btn-primary',
  },
];
