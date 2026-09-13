/**
 * This app's keyboard commands.
 *
 * `keyboard-shortcuts.ts` is shared across the three apps and holds no list of
 * its own; each app supplies one, the way `navbar-action-list.ts` supplies the
 * navbar's. Nothing here is a shortcut to a feature that does not exist: there
 * is no load modal to open, so `Ctrl+O` reaches the feed switcher, which is
 * what picking a feed means here.
 *
 * Writes are deliberately unbound. Every one of them is a form behind a button
 * on the object it changes, and a key that creates an alert or provisions a
 * tracker from anywhere is a key pressed by accident.
 */

import type { ShortcutCommand } from './keyboard-shortcuts';

interface ShortcutHost {
  /** Open the feed switcher and select whatever it returns. */
  openFeedSwitcher: () => Promise<void>;
  /** Open the guide, through the modal router so the hash names it. */
  openGuide: () => void;
  /** Drop the search text and its result list. */
  clearSearch: () => void;
}

export function managerShortcuts(host: ShortcutHost): ShortcutCommand[] {
  return [
    {
      keys: 'ctrl+o',
      description: 'Open the feed switcher',
      handler: (e) => {
        e?.preventDefault();
        return host.openFeedSwitcher();
      },
    },
    // Two keys for one action: `/` is the map convention and Ctrl+K the
    // command-palette one, and neither is worth making the user guess.
    {
      keys: '/',
      description: 'Focus map search',
      handler: (e) => {
        e?.preventDefault();
        focusMapSearch();
      },
    },
    {
      keys: 'ctrl+k',
      description: 'Focus map search',
      handler: (e) => {
        e?.preventDefault();
        focusMapSearch();
      },
    },
    // Allowed in input fields: Escape from inside the search box is the main
    // way this one is pressed.
    {
      keys: 'escape',
      description: 'Clear the search',
      allowInInputFields: true,
      handler: () => {
        (document.getElementById('map-search') as HTMLInputElement | null)?.blur();
        host.clearSearch();
      },
    },
    // `?` is Shift+/, so the normalized key string carries the modifier.
    {
      keys: 'shift+?',
      description: 'Show the guide',
      handler: (e) => {
        e?.preventDefault();
        host.openGuide();
      },
    },
  ];
}

function focusMapSearch(): void {
  const mapSearch = document.getElementById('map-search') as HTMLInputElement | null;
  mapSearch?.focus();
  mapSearch?.select();
}
