/* @vendored-from coloring-book:src/modules/navbar-actions.ts
   @sha dca23b3
   @status modified
   @changes
   - NAVBAR_ACTIONS is yard-master's own row: calendar, share, alerts, theme,
     about, the account link and the feed switcher. None of coloring-book's
     editor actions exist here.
   - Added the `link` kind for the account control, which is an `<a>` to
     Keycloak's Account Console opened in a new tab, starts hidden and gets its
     text and href at boot.
   - `LabeledAction` gained `labelId`, because the feed switcher's label is the
     selected feed's name and is rewritten on every feed change.
   - `IconAction` gained `badgeClass`, because the alerts badge is
     `badge-error` while the calendar's is `badge-primary`; badge spans also
     carry `tabular-nums` so a changing count does not shift width.
   - Dropped `renderDockIcons` and `DOCK_ICONS`: there is no mobile dock here,
     the bottom sheet covers that.
   - `alerts` and `share` icon paths are local, since neither action exists
     upstream and `nav-icons.ts` is vendored verbatim.
   - No `console.log` on render. */
import { escapeHtml } from '../utils/escape-html';
import { renderNavIcon, renderMoonIcon, renderSunIcon } from './nav-icons';

/**
 * The navbar's action row, as data.
 *
 * Every entry renders through one of the shapes below, so an action cannot end
 * up with a different box, a different icon size, a missing tooltip or a
 * missing accessible label than its neighbours: the `label` field feeds both
 * `data-tip` and `aria-label`, and the button classes come from the renderer,
 * not the entry.
 *
 * Element ids are the contract with the click wiring and the badge writers in
 * `src/index.ts`.
 */

/** Heroicons v2 24-outline path data for the two actions nav-icons.ts lacks. */
const LOCAL_ICON_PATHS = {
  alerts:
    'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z',
  share:
    'M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z',
} as const;

function renderLocalIcon(name: keyof typeof LOCAL_ICON_PATHS): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="${LOCAL_ICON_PATHS[name]}" /></svg>`;
}

interface CommonAction {
  /** Element id of the control itself. */
  id: string;
  /** Tooltip text and accessible name. */
  label: string;
  /** Consecutive entries sharing a group render in one tighter cluster. */
  group?: string;
}

interface IconAction extends CommonAction {
  kind: 'icon';
  icon: string;
  /** Id for the count badge span; omitted means no badge. */
  badgeId?: string;
  /** daisyUI badge colour, e.g. `badge-error`. */
  badgeClass?: string;
  /** Hidden below the `md` breakpoint. */
  desktopOnly?: boolean;
  disabled?: boolean;
  /** Id on the tooltip wrapper, for actions whose tip changes at runtime. */
  tooltipId?: string;
}

interface ToggleAction extends CommonAction {
  kind: 'toggle';
  /** Shown when the checkbox is checked / unchecked. */
  iconOn: string;
  iconOff: string;
  /** Class the controlling module delegates on (e.g. `theme-controller`). */
  inputClass: string;
  value?: string;
}

interface LabeledAction extends CommonAction {
  kind: 'labeled';
  icon: string;
  /** Button style, e.g. `btn-primary`. */
  btnClass: string;
  /** Id on the label span, for a label rewritten at runtime. */
  labelId?: string;
  disabled?: boolean;
}

interface LinkAction extends CommonAction {
  kind: 'link';
  /** Rendered hidden; the shell reveals it once it has an href to give. */
  hidden?: boolean;
}

type NavbarAction = IconAction | ToggleAction | LabeledAction | LinkAction;

const ICON_BTN_CLASS = 'btn btn-ghost btn-sm btn-square';

const NAVBAR_ACTIONS: NavbarAction[] = [
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
    icon: renderLocalIcon('share'),
  },
  {
    kind: 'icon',
    id: 'alerts-btn',
    // Every managed alert on this feed. The badge counts them.
    label: 'Service alerts',
    icon: renderLocalIcon('alerts'),
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
    id: 'about-btn',
    label: 'About',
    icon: renderNavIcon('guide'),
  },
  {
    kind: 'link',
    id: 'user-btn',
    // The signed-in person, labelled with their own name or address. href and
    // text come from /api/me's account_url at boot. A new tab, like cafe-car's
    // own account page: Keycloak's console is a different origin with no link
    // back, so navigating there in this tab strands the map.
    label: 'Account',
    hidden: true,
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

function renderAction(action: NavbarAction): string {
  const label = escapeHtml(action.label);

  if (action.kind === 'labeled') {
    const disabled = action.disabled ? ' disabled' : '';
    const labelId = action.labelId ? ` id="${action.labelId}"` : '';
    return `<button id="${action.id}" class="btn btn-sm ${action.btnClass}" aria-label="${label}"${disabled}>${action.icon}<span${labelId} class="hidden md:inline">${label}</span></button>`;
  }

  if (action.kind === 'link') {
    const hidden = action.hidden ? ' hidden' : '';
    return `<a id="${action.id}" class="btn btn-ghost btn-sm${hidden}" href="#" target="_blank" rel="noopener noreferrer" aria-label="${label}"></a>`;
  }

  const control =
    action.kind === 'toggle'
      ? `<label id="${action.id}" class="${ICON_BTN_CLASS} swap swap-rotate" aria-label="${label}">` +
        `<input type="checkbox" class="${action.inputClass}"${action.value ? ` value="${action.value}"` : ''} />` +
        `${action.iconOn}${action.iconOff}</label>`
      : `<button id="${action.id}" class="${ICON_BTN_CLASS}" aria-label="${label}"` +
        `${action.disabled ? ' disabled' : ''}>${action.icon}</button>`;

  const tooltipId =
    action.kind === 'icon' && action.tooltipId
      ? ` id="${action.tooltipId}"`
      : '';
  const tooltip = `<div class="tooltip tooltip-bottom"${tooltipId} data-tip="${label}">${control}</div>`;

  const badgeId = action.kind === 'icon' ? action.badgeId : undefined;
  const desktopOnly = action.kind === 'icon' && action.desktopOnly;

  // The indicator only exists to anchor a badge; without one the tooltip
  // wrapper carries the responsive class itself.
  if (!badgeId) {
    return desktopOnly
      ? `<div class="indicator hidden md:inline-flex">${tooltip}</div>`
      : tooltip;
  }
  const indicatorClass = desktopOnly
    ? 'indicator hidden md:inline-flex'
    : 'indicator';
  const badgeClass =
    (action.kind === 'icon' && action.badgeClass) || 'badge-primary';
  return `<div class="${indicatorClass}"><span id="${badgeId}" class="indicator-item badge badge-xs ${badgeClass} tabular-nums hidden"></span>${tooltip}</div>`;
}

/** Render every navbar action into the container, grouped clusters included. */
export function renderNavbarActions(container: HTMLElement): void {
  const parts: string[] = [];
  let index = 0;

  while (index < NAVBAR_ACTIONS.length) {
    const action = NAVBAR_ACTIONS[index];
    if (!action.group) {
      parts.push(renderAction(action));
      index += 1;
      continue;
    }

    const cluster: string[] = [];
    const { group } = action;
    while (
      index < NAVBAR_ACTIONS.length &&
      NAVBAR_ACTIONS[index].group === group
    ) {
      cluster.push(renderAction(NAVBAR_ACTIONS[index]));
      index += 1;
    }
    parts.push(
      `<div class="flex items-center gap-1">${cluster.join('')}</div>`
    );
  }

  container.innerHTML = parts.join('');
}
