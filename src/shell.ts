/**
 * Mounts the shared app shell. Imported first by `index.ts`, so the markup
 * exists before any other module is evaluated and looks up an element id.
 */

import { mountAppShell } from 'interlocking/ui/app-shell';

// No dock: the panel is the whole of the mobile UI here.
mountAppShell({
  brandPrefix: 'manage',
  brandSuffix: '.rt.gtfs.zone',
  panelPlaceholder: 'No feed selected',
});
