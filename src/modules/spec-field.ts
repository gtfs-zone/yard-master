/**
 * A form label that carries what the GTFS-realtime reference says about the
 * field underneath it.
 *
 * Every field in the alert and informed-entity forms names a real message field
 * in `src/gtfs-rt-spec/`, and that spec entry holds the reference's own
 * description verbatim. This module turns one into the label markup:
 * the name, a presence mark, and a hover/focus tooltip with the description,
 * the field's id, its type, its presence and its cardinality.
 *
 * The tooltip is a portal rather than a positioned child, because these labels
 * render inside a modal body that scrolls: see `src/utils/tooltip-position.ts`
 * for why that clips a CSS tooltip. `initFieldTooltipPortal()` is called once,
 * from `src/index.ts`.
 *
 * Modelled on coloring-book's `renderFieldLabelContent`, but not vendored from
 * it: that one is built around a `FieldConfig` describing a schedule table
 * column, and this one is built around an `RTFieldSpec`.
 */

import type { RTEnumSpec, RTFieldSpec, RTPresence } from '../gtfs-rt-spec/types';
import { rtEnum, rtField } from '../gtfs-rt-spec/index';
import { renderSpecDescription, renderSpecDescriptionPlain } from '../utils/spec-markup';
import { escHtml } from './render-utils';

/** Which message field a form field is. Resolved against `src/gtfs-rt-spec/`. */
export interface SpecRef {
  message: string;
  field: string;
}

const REFERENCE_URL = 'https://gtfs.org/documentation/realtime/reference/';

/** The published reference's anchor for a message, so the label can link out. */
function messageUrl(message: string): string {
  return `${REFERENCE_URL}#message-${message.toLowerCase()}`;
}

/** The spec entry a form field names, or undefined for one that names nothing. */
export function resolveSpec(ref: SpecRef | undefined): RTFieldSpec | undefined {
  return ref ? rtField(ref.message, ref.field) : undefined;
}

/**
 * The coloured `*` after a label. Optional fields get nothing: a mark on every
 * field is a mark on none.
 */
function presenceMark(presence: RTPresence): string {
  if (presence === 'Optional') return '';
  const colors: Partial<Record<RTPresence, string>> = {
    Required: 'text-error',
    'Conditionally Required': 'text-warning',
    'Conditionally Forbidden': 'text-base-content opacity-40',
  };
  return ` <span class="${colors[presence] ?? ''}">*</span>`;
}

/**
 * The tooltip body: the reference's prose, then the facts about the field that
 * do not fit in a label.
 *
 * The description is rendered rather than escaped, because it is stored with
 * the reference's markup in it and `renderSpecDescription` is what turns that
 * into HTML. Its inputs are compile-time constants either way.
 */
export function specTooltipContent(ref: SpecRef, spec: RTFieldSpec): string {
  const parts: string[] = [];
  if (spec.description) parts.push(renderSpecDescription(spec.description));
  parts.push(
    `<div class="opacity-70">ID: <code class="text-xs">${escHtml(ref.message)}.${escHtml(
      spec.name
    )}</code></div>`
  );
  parts.push(
    `<div class="opacity-70">Type: <code class="text-xs">${escHtml(spec.type)}</code>${
      spec.cardinality === 'Many' ? ', repeated' : ''
    }</div>`
  );
  parts.push(`<div class="opacity-70">Presence: ${escHtml(spec.presence)}</div>`);
  if (spec.experimental) {
    parts.push('<div class="opacity-70">Still experimental, and subject to change.</div>');
  }
  return parts.join('');
}

/**
 * A form field's label content: the name linked to the reference, its presence
 * mark, and the tooltip trigger around both.
 *
 * A field with no spec entry renders as its plain label, so a form can mix
 * spec fields with this app's own without two label paths.
 */
export function specLabelContent(label: string, ref?: SpecRef): string {
  const spec = resolveSpec(ref);
  if (!ref || !spec) return escHtml(label);

  const linked = `<a class="link link-hover" href="${escHtml(messageUrl(ref.message))}"
    target="_blank" rel="noopener noreferrer">${escHtml(label)}</a>`;
  return `<span class="field-tooltip-trigger cursor-help" tabindex="0"
    data-tooltip-content="${escHtml(specTooltipContent(ref, spec))}"
    >${linked}</span>${presenceMark(spec.presence)}`;
}

/**
 * One enum value's description, flattened to a line.
 *
 * `Cause`, `Effect` and `SeverityLevel` are listed in the reference as bare
 * values with no Comment column, so this is empty for every value the alert
 * form offers. It is not dead: the enums that do carry comments render through
 * the same path, and a reference refresh can give any of them one.
 */
export function enumValueDescription(enumName: string, value: string): string {
  const spec: RTEnumSpec | undefined = rtEnum(enumName);
  const entry = spec?.values.find((v) => v.value === value);
  return entry?.description ? renderSpecDescriptionPlain(entry.description) : '';
}
