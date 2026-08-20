/**
 * Shell boot. Phase 1 stands the furniture up: theme, map, panel resizer and
 * bottom sheet. The feed switcher, the hash state and the panel's contents
 * land in phases 3 and 4 (see CURRENT_PLAN.md).
 */
import { MapController } from './map-controller';
import { notify } from './modules/notification-system';
import { PanelResizer, restorePanelWidth } from './modules/panel-resizer';
import { BottomSheetController } from './modules/bottom-sheet';
import { ThemeController } from './modules/theme-controller';

const version = document.getElementById('app-version');
if (version) version.textContent = __APP_VERSION__;

const appContainer = document.querySelector<HTMLElement>('.app-container')!;
restorePanelWidth(appContainer);

notify.initialize();

const themeController = new ThemeController();
themeController.initialize();

const mapCtrl = new MapController();
mapCtrl.initialize('map');
// The map accent is resolved from the daisyUI palette, so it has to be
// repainted whenever the theme switches; `refreshAccentColor` clears the
// per-token cache in `theme-color.ts` on the way through.
themeController.onThemeChange(() => mapCtrl.refreshAccentColor());

new PanelResizer(appContainer, mapCtrl);

const rightPanel = document.getElementById('right-panel')!;
const bottomSheet = new BottomSheetController(rightPanel);
// On mobile the sheet sits over the map, so the camera has to hold a focused
// feature above it rather than centring it under the sheet.
bottomSheet.onSnapChange((covered) => mapCtrl.setBottomPadding(covered));
