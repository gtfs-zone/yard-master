/* @vendored-from test-track:src/modules/basemap-control.ts
   @sha bac60b6
   @status modified
   @changes
   - `ShapeToggleControl` is kept, with `MapAppearance.shapeMode`,
     `onRenderModeChange` and `getShapeMode`. Upstream dropped the control when
     coloring-book did; `layer-manager.ts` here still draws a route either from
     its shape or stop-to-stop, and `map-controller.ts` still persists the mode. */
/* @vendored-from coloring-book:src/modules/basemap-control.ts
   @sha 058d254
   @status verbatim */
/**
 * Basemap control UI component using DaisyUI FAB and speed dial
 */

import { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import { basemapStyles, getBasemapStyle } from './basemap-styles';

export type ShapeMode = 'shapes' | 'stops';

export interface MapAppearance {
  basemap: string;
  shapeMode: ShapeMode;
}

export interface BasemapControlOptions {
  initial?: Partial<MapAppearance>;
  onRenderModeChange?: (mode: ShapeMode) => void;
  /** Fired whenever the basemap or the shape mode changes. */
  onAppearanceChange?: (appearance: MapAppearance) => void;
}

const SKY = {
  'sky-color': '#199EF3',
  'sky-horizon-blend': 0.5,
  'horizon-color': '#ffffff',
  'horizon-fog-blend': 0.5,
  'fog-color': '#0000ff',
  'fog-ground-blend': 0.5,
  'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 10, 1, 12, 0],
};

/** Merge the globe projection and its sky into a style spec. */
function globeStyle(style: Record<string, unknown>): StyleSpecification {
  return {
    ...style,
    projection: { type: 'globe' },
    sky: SKY,
  } as unknown as StyleSpecification;
}

/**
 * The style the map should be constructed with, so the very first paint is
 * already the requested basemap on the globe. Without this the control would
 * have to `setStyle` right after load, which destroys any layers added in
 * between.
 *
 * No caller here: this app boots one hardcoded basemap and persists nothing.
 * Kept so the file stays one copy across the three apps rather than forking on
 * an export.
 *
 * @lintignore
 */
export function initialMapStyle(
  appearance: Partial<MapAppearance>
): StyleSpecification {
  const basemap =
    getBasemapStyle(appearance.basemap ?? 'standard') ?? basemapStyles[0];
  return globeStyle(basemap.style);
}

const CONTROL_STYLE_ID = 'basemap-control-styles';

/**
 * Toggle control for switching route render mode between GTFS shapes and
 * straight stop-to-stop lines. Owned by BasemapControl so it survives
 * basemap rebuilds with its state intact.
 */
export class ShapeToggleControl {
  private currentMode: ShapeMode;
  private readonly onModeChange: (mode: ShapeMode) => void;

  constructor(
    onModeChange: (mode: ShapeMode) => void,
    initialMode: ShapeMode = 'shapes'
  ) {
    this.onModeChange = onModeChange;
    this.currentMode = initialMode;
  }

  public getMode(): ShapeMode {
    return this.currentMode;
  }

  public setMode(mode: ShapeMode): void {
    this.currentMode = mode;
  }

  /** Returns the HTML string to inject into the BasemapControl container. */
  public render(): string {
    const checked = this.currentMode === 'shapes' ? 'checked' : '';
    return `
      <label class="swap swap-rotate btn btn-lg btn-circle btn-neutral shape-toggle-swap" title="Toggle route geometry (shapes / straight lines)" aria-label="Toggle route geometry (shapes / straight lines)">
        <input type="checkbox" class="shape-toggle-input" ${checked} />
        <!-- Shapes icon: wavy line (shown when checked = shapes mode) -->
        <svg class="swap-on w-6 h-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3 12c1.5-6 3-6 4.5 0s3 6 4.5 0 3-6 4.5 0 3 6 4.5 0"/>
        </svg>
        <!-- Stops icon: straight polyline with nodes (shown when unchecked = stops mode) -->
        <svg class="swap-off w-6 h-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 17l8-10 8 5"/>
          <circle cx="4" cy="17" r="1.5" fill="currentColor" stroke="none"/>
          <circle cx="12" cy="7" r="1.5" fill="currentColor" stroke="none"/>
          <circle cx="20" cy="12" r="1.5" fill="currentColor" stroke="none"/>
        </svg>
      </label>
    `;
  }

  /** Wire up the change listener after render() HTML has been inserted. */
  public attachListener(container: HTMLElement): void {
    const input = container.querySelector(
      '.shape-toggle-input'
    ) as HTMLInputElement | null;
    if (!input) {
      return;
    }
    input.addEventListener('change', (e) => {
      this.currentMode = (e.target as HTMLInputElement).checked
        ? 'shapes'
        : 'stops';
      this.onModeChange(this.currentMode);
    });
  }
}

export class BasemapControl {
  private map: MapLibreMap;
  private container: HTMLElement | null = null;
  private currentBasemap: string;
  private shapeToggleControl: ShapeToggleControl | null = null;
  private onAppearanceChange: ((appearance: MapAppearance) => void) | null;

  constructor(map: MapLibreMap, options: BasemapControlOptions = {}) {
    this.map = map;
    this.currentBasemap = options.initial?.basemap ?? 'standard';
    this.onAppearanceChange = options.onAppearanceChange ?? null;

    if (options.onRenderModeChange) {
      const onChange = options.onRenderModeChange;
      this.shapeToggleControl = new ShapeToggleControl((mode) => {
        onChange(mode);
        this.emitAppearance();
      }, options.initial?.shapeMode ?? 'shapes');
    }

    this.createControl();
    this.applyGlobeProjection();
  }

  public getAppearance(): MapAppearance {
    return {
      basemap: this.currentBasemap,
      shapeMode: this.shapeToggleControl?.getMode() ?? 'shapes',
    };
  }

  public getShapeMode(): ShapeMode {
    return this.shapeToggleControl?.getMode() ?? 'shapes';
  }

  private emitAppearance(): void {
    this.onAppearanceChange?.(this.getAppearance());
  }

  /**
   * Put the globe on whatever style the map booted with. Skipped when the map
   * was constructed from `initialMapStyle()`, which already carries it, since
   * `setStyle` here would destroy any layers added in the meantime.
   */
  private applyGlobeProjection(): void {
    const apply = () => {
      const current = this.map.getStyle() as unknown as
        | Record<string, unknown>
        | undefined;
      if (!current) {
        return;
      }
      const projection = current.projection as { type?: string } | undefined;
      if (projection?.type === 'globe') {
        return;
      }
      this.map.setStyle(globeStyle(current));
    };

    if (this.map.isStyleLoaded()) {
      apply();
    } else {
      this.map.once('load', apply);
    }
  }

  /**
   * Create the basemap control UI
   */
  private createControl(): void {
    // Create container
    this.container = document.createElement('div');
    this.container.className = 'basemap-control';
    this.container.style.cssText = `
      position: absolute;
      bottom: 40px;
      right: 10px;
      display: flex;
      gap: 12px;
      align-items: flex-end;
      flex-direction: row;
      pointer-events: none;
    `;

    // Get current basemap
    const currentStyle = basemapStyles.find(
      (s) => s.id === this.currentBasemap
    );
    const otherStyles = basemapStyles.filter(
      (s) => s.id !== this.currentBasemap
    );

    // Create FAB structure with vertical labeled layout
    this.container.innerHTML = `
      <div class="fab">
        <!-- Main FAB button (shows current basemap) -->
        <div tabindex="0" role="button" class="btn btn-lg btn-circle btn-neutral basemap-fab-main">
          ${currentStyle?.icon || basemapStyles[0].icon}
        </div>

        <!-- Main Action button (appears when FAB is open) -->
        <button class="fab-main-action btn btn-circle btn-lg btn-neutral basemap-current" data-basemap="${this.currentBasemap}" title="${currentStyle?.name || 'Standard'}">
          ${currentStyle?.icon || basemapStyles[0].icon}
        </button>

        <!-- Other basemap buttons with labels -->
        ${otherStyles
          .map(
            (style) => `
          <div class="flex items-center gap-2">
            <span class="bg-base-100 text-base-content text-sm px-2 py-1 rounded-lg shadow whitespace-nowrap">${style.name}</span>
            <button class="btn btn-lg btn-circle btn-base-100 basemap-btn" data-basemap="${style.id}">
              ${style.icon}
            </button>
          </div>
        `
          )
          .join('')}
      </div>

      ${this.shapeToggleControl ? this.shapeToggleControl.render() : ''}
    `;

    this.injectStyles();
    this.attachEventListeners();

    // Add to map container
    const mapContainer = this.map.getContainer();

    // Ensure map container has position relative for absolute positioning to work
    const computedStyle = window.getComputedStyle(mapContainer);
    if (computedStyle.position === 'static') {
      mapContainer.style.position = 'relative';
    }

    mapContainer.appendChild(this.container);
  }

  /** Injected once, since `rebuildControl` runs on every basemap change. */
  private injectStyles(): void {
    if (document.getElementById(CONTROL_STYLE_ID)) {
      return;
    }
    const style = document.createElement('style');
    style.id = CONTROL_STYLE_ID;
    style.textContent = `
      .basemap-control .fab {
        position: relative;
        inset-inline-end: 0;
        bottom: auto;
        pointer-events: none;
      }

      .basemap-control .fab button,
      .basemap-control .fab [role="button"],
      .basemap-control .fab label {
        pointer-events: auto;
      }

      .basemap-control .shape-toggle-swap {
        flex-shrink: 0;
        pointer-events: auto;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Attach event listeners for basemap selection
   */
  private attachEventListeners(): void {
    if (!this.container) {
      return;
    }

    // Basemap selection buttons (plus the current one in the FAB centre)
    this.container
      .querySelectorAll('.basemap-btn, .basemap-current')
      .forEach((button) => {
        button.addEventListener('click', () => {
          const basemapId = (button as HTMLElement).getAttribute(
            'data-basemap'
          );
          if (basemapId) {
            this.changeBasemap(basemapId);
          }
        });
      });

    // Shape/stops render mode toggle
    if (this.shapeToggleControl) {
      this.shapeToggleControl.attachListener(this.container);
    }
  }

  /**
   * Swap the style, restore the view once it lands, and tell everyone else to
   * re-add their layers, since `setStyle` drops every source and layer we own.
   */
  private applyStyle(
    style: StyleSpecification,
    detail: Record<string, unknown>
  ): void {
    const center = this.map.getCenter();
    const zoom = this.map.getZoom();
    const bearing = this.map.getBearing();
    const pitch = this.map.getPitch();

    this.map.setStyle(style);

    this.map.once('styledata', () => {
      this.map.setCenter(center);
      this.map.setZoom(zoom);
      this.map.setBearing(bearing);
      this.map.setPitch(pitch);
      this.map.fire('basemap:changed', detail);
    });
  }

  /**
   * Change the basemap style
   */
  private changeBasemap(basemapId: string): void {
    // Skip if already on this basemap
    if (basemapId === this.currentBasemap) {
      return;
    }

    const basemapStyle = getBasemapStyle(basemapId);
    if (!basemapStyle) {
      console.error(`Basemap style not found: ${basemapId}`);
      return;
    }

    this.applyStyle(globeStyle(basemapStyle.style), { basemapId });

    this.currentBasemap = basemapId;
    this.rebuildControl();
    this.emitAppearance();
  }

  /**
   * Rebuild the control UI to reflect new basemap selection
   */
  private rebuildControl(): void {
    if (!this.container) {
      return;
    }
    this.container.remove();
    this.createControl();
  }

  /**
   * Get current basemap ID
   */
  public getCurrentBasemap(): string {
    return this.currentBasemap;
  }

  /**
   * Programmatically set basemap
   */
  public setBasemap(basemapId: string): void {
    this.changeBasemap(basemapId);
  }

  /**
   * Remove the control from the map
   */
  public destroy(): void {
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.container = null;
  }
}
