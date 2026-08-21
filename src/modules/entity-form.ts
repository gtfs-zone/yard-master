/**
 * The one way this app asks somebody to fill something in.
 *
 * Every properties page is a synchronous string renderer that is re-run on
 * every session event, so an `<input>` rendered into the panel loses what was
 * typed into it the moment a tracker updates. A form therefore lives in a
 * modal, which owns its own DOM and outlives every re-render underneath it.
 * That is the whole reason this module exists rather than each page growing an
 * edit mode.
 *
 * What it owns:
 *
 * - **Dirty tracking.** Save is disabled until something actually changed, and
 *   Revert puts the initial values back. A form that was never touched cannot
 *   be saved, so an accidental Enter cannot rewrite a field with itself. A
 *   create form whose defaults are already the answer opts out with
 *   `allowPristine`.
 * - **In flight.** Every button is disabled while the request is out, which
 *   `showModal` already does for the action it triggered; the modal stays open
 *   until the write succeeds.
 * - **Field errors.** A 422's `detail` names the field it is about, and
 *   `ApiError.fields` keeps that mapping, so the message lands under the input
 *   that caused it. This is the thing the old SQLAdmin did well and the one
 *   piece of it that had to survive.
 *
 * A 409 is different: it is a conflict about the whole request, and only the
 * caller knows which field to blame ("that feed name is taken" belongs under
 * `feed_name`). `conflictField` is how a caller says so.
 */

import { ApiError, SessionExpiredError } from './api-client';
import { showModal } from './modal-utils';
import { escHtml } from './render-utils';

export type FieldType =
  | 'text'
  | 'textarea'
  | 'url'
  | 'number'
  | 'select'
  | 'datetime'
  | 'checkbox'
  | 'file';

export interface FormField {
  /** The request-body key, and what a 422 names the field by. */
  name: string;
  label: string;
  type?: FieldType;
  /** The value the form opens with. Null and undefined both mean empty. */
  value?: string | number | null;
  /** For `select`. The empty value is offered as "—" unless one is supplied. */
  options?: { value: string; label: string }[];
  placeholder?: string;
  /** A line under the input, for the rule a person cannot guess. */
  help?: string;
  /** Read-only fields still render, because context is half of a form. */
  readonly?: boolean;
  autofocus?: boolean;
  /** For `file`. Passed straight to the input's `accept`. */
  accept?: string;
  /**
   * For `file`. Called whenever the chosen file changes, with the slot under
   * the drop zone to render into.
   *
   * The form owns the input and the dirty tracking; what a particular file
   * *means* is the caller's business, which for a schedule zip is a parse this
   * module has no reason to know about. Rendering into a slot rather than
   * returning markup lets that be async: the caller can put a spinner in and
   * replace it when the answer arrives.
   */
  onFile?: (file: File | null, slot: HTMLElement) => void;
  /**
   * Show this field only while another one holds a given value.
   *
   * For a form that is really two forms sharing a header — a new feed is
   * either a URL or a zip, and the field that does not apply is noise rather
   * than a choice. A hidden field is still read and still submitted, so the
   * caller decides what to do with it; nothing here guesses.
   */
  visibleWhen?: { field: string; equals: string };
}

export interface EntityFormOptions<T> {
  title: string;
  fields: FormField[];
  /** Above the fields: what this form is about to do, when that is not obvious. */
  intro?: string;
  submitLabel?: string;
  /**
   * Checked before the request. Return a message per field to stop the save;
   * return nothing to let it through. For rules the server cannot know, like
   * "these two must match".
   */
  validate?: (values: Record<string, string>) => Record<string, string> | null;
  /**
   * The write itself. Whatever it resolves to is what the form resolves to.
   *
   * `files` carries what a `file` field is holding, keyed the same way. It is
   * a second argument rather than a value in `values` because a `File` is not
   * a string and pretending otherwise would break dirty tracking for every
   * other field.
   */
  submit: (
    values: Record<string, string>,
    files: Record<string, File | null>
  ) => Promise<T>;
  /** Which field a 409's message belongs under, if any. */
  conflictField?: string;
  /**
   * Let a form be saved without being touched.
   *
   * Off by default, because an untouched edit form saving is an accidental
   * Enter rewriting a field with itself. A *create* form whose defaults are all
   * already right is the opposite case: the whole point of prefilling it is
   * that it can be accepted as it stands.
   */
  allowPristine?: boolean;
}

/** The current value of every field, keyed by name. */
function readValues(root: HTMLElement, fields: FormField[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of fields) {
    const el = root.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      `[data-field="${CSS.escape(field.name)}"]`
    );
    if (!el) continue;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') {
      values[field.name] = String(el.checked);
    } else if (el instanceof HTMLInputElement && el.type === 'file') {
      // The name, not the file: this is the string dirty tracking compares and
      // `validate` reads, and "" is how a form says nothing was chosen.
      values[field.name] = el.files?.[0]?.name ?? '';
    } else {
      values[field.name] = el.value;
    }
  }
  return values;
}

/** The `File` each `file` field is holding, keyed by field name. */
function readFiles(root: HTMLElement, fields: FormField[]): Record<string, File | null> {
  const files: Record<string, File | null> = {};
  for (const field of fields) {
    if (field.type !== 'file') continue;
    const el = root.querySelector<HTMLInputElement>(
      `input[data-field="${CSS.escape(field.name)}"]`
    );
    files[field.name] = el?.files?.[0] ?? null;
  }
  return files;
}

function renderInput(field: FormField): string {
  const type = field.type ?? 'text';
  const value = field.value === null || field.value === undefined ? '' : String(field.value);
  const common =
    `data-field="${escHtml(field.name)}"` +
    (field.readonly ? ' disabled' : '') +
    (field.autofocus ? ' autofocus' : '') +
    (field.placeholder ? ` placeholder="${escHtml(field.placeholder)}"` : '');

  if (type === 'textarea') {
    return `<textarea ${common} class="textarea textarea-bordered textarea-sm w-full"
      rows="3">${escHtml(value)}</textarea>`;
  }
  if (type === 'select') {
    const options = field.options ?? [];
    const hasEmpty = options.some((o) => o.value === '');
    return `<select ${common} class="select select-bordered select-sm w-full">
      ${hasEmpty ? '' : '<option value="">—</option>'}
      ${options
        .map(
          (o) =>
            `<option value="${escHtml(o.value)}"${o.value === value ? ' selected' : ''}>${escHtml(
              o.label
            )}</option>`
        )
        .join('')}
    </select>`;
  }
  if (type === 'file') {
    // A label wrapping a hidden input is the whole drop zone: clicking
    // anywhere in it opens the picker without a click handler, and it stays
    // keyboard-reachable because the input itself is still focusable. The
    // input is off-screen rather than hidden, so the zone has to draw that
    // focus itself or a keyboard user gets no ring at all.
    return `<label class="flex flex-col items-center justify-center gap-1 cursor-pointer
        rounded-lg border border-dashed border-base-300 hover:border-primary
        has-[:focus-visible]:border-primary has-[:focus-visible]:ring-1
        bg-base-200 px-4 py-6 text-center" data-drop="${escHtml(field.name)}">
      <input ${common} type="file" class="sr-only"${
        field.accept ? ` accept="${escHtml(field.accept)}"` : ''
      } />
      <span class="text-xs opacity-70" data-drop-label>Drop a file here, or click to choose one</span>
    </label>
    <div class="pt-2 empty:hidden" data-preview="${escHtml(field.name)}"></div>`;
  }
  if (type === 'checkbox') {
    return `<input ${common} type="checkbox" class="toggle toggle-sm"${
      value === 'true' ? ' checked' : ''
    } />`;
  }

  // `url` is deliberately a text input: `type="url"` brings the browser's own
  // validation bubble, which fires before the request and cannot be styled to
  // match the field errors the server sends back.
  const inputType = type === 'number' ? 'number' : type === 'datetime' ? 'datetime-local' : 'text';
  return `<input ${common} type="${inputType}" value="${escHtml(value)}"
    class="input input-bordered input-sm w-full" autocomplete="off" />`;
}

function renderField(field: FormField): string {
  // A `file` field's drop zone is itself a `<label>`, so this one is a plain
  // block: a label inside a label swallows the inner one's clicks.
  const tag = field.type === 'file' ? 'div' : 'label';
  const when = field.visibleWhen;
  return `
    <${tag} class="form-control"${
      when
        ? ` data-when-field="${escHtml(when.field)}" data-when-equals="${escHtml(when.equals)}"`
        : ''
    }>
      <span class="label-text text-xs">${escHtml(field.label)}</span>
      ${renderInput(field)}
      ${field.help ? `<span class="label-text-alt opacity-50">${escHtml(field.help)}</span>` : ''}
      <span class="label-text-alt text-error hidden" data-error="${escHtml(field.name)}"></span>
    </${tag}>`;
}

/**
 * Show a form and run its write. Resolves to what `submit` returned, or null if
 * the person closed the dialog without saving.
 */
export async function showEntityForm<T>(options: EntityFormOptions<T>): Promise<T | null> {
  let result: T | null = null;
  // Assigned by `onMount`, which runs before any button can be clicked.
  let save: () => Promise<boolean> = async () => true;
  let revert: () => boolean = () => true;

  await showModal({
    title: escHtml(options.title),
    body: `
      ${options.intro ? `<p class="text-xs opacity-70 pb-3">${escHtml(options.intro)}</p>` : ''}
      <div class="alert alert-error alert-sm text-xs hidden" data-form-error></div>
      <div class="space-y-3" data-form>
        ${options.fields.map(renderField).join('')}
      </div>`,
    actions: [
      { label: 'Revert', className: 'btn-ghost', onClick: () => revert() },
      { label: 'Cancel', onClick: () => {} },
      {
        label: options.submitLabel ?? 'Save',
        className: 'btn-primary',
        // `showModal` disables every button while this promise is pending and
        // re-enables them if it returns true, which is exactly the in-flight
        // behaviour a save needs. Returning true keeps the modal open with
        // what was typed still in it, which is what a validation error wants.
        onClick: () => save(),
      },
    ],
    // Escape is Cancel. Enter is deliberately not wired to Save: several of
    // these forms have a textarea, and a form that saves on Enter in one field
    // and not another is worse than one that never does.
    escapeAction: 1,
    boxClassName: 'max-w-lg',
    onMount: () => {
      // The innermost modal, which is the one just appended: these can stack,
      // and a form opened from a form must not read the one underneath it.
      const forms = document.querySelectorAll<HTMLElement>('.modal-open [data-form]');
      const root = forms[forms.length - 1];
      const box = root.closest<HTMLElement>('.modal-box')!;
      const banner = box.querySelector<HTMLElement>('[data-form-error]')!;
      const buttons = box.querySelectorAll<HTMLButtonElement>('button[data-idx]');
      const [revertBtn, , saveBtn] = buttons;

      const initial = readValues(root, options.fields);

      /**
       * Show or hide the fields that only apply to one branch of the form.
       *
       * Re-run on every change rather than wired per controlling field: the
       * condition names a field by string, and one pass over all of them is
       * cheaper than tracking which one moved.
       */
      const syncVisibility = (): void => {
        const now = readValues(root, options.fields);
        root.querySelectorAll<HTMLElement>('[data-when-field]').forEach((el) => {
          const on = now[el.dataset.whenField!] === el.dataset.whenEquals;
          el.classList.toggle('hidden', !on);
        });
      };

      /**
       * The drop zones: a drop puts the file into the input, and every change
       * of file tells the caller so it can preview it.
       *
       * `DataTransfer` is the only way to write a file input's `files`, and it
       * is what makes drag-and-drop and the picker the same code path rather
       * than two sources of truth the form has to reconcile.
       */
      for (const field of options.fields) {
        if (field.type !== 'file') continue;
        const zone = root.querySelector<HTMLElement>(
          `[data-drop="${CSS.escape(field.name)}"]`
        );
        const input = root.querySelector<HTMLInputElement>(
          `input[data-field="${CSS.escape(field.name)}"]`
        );
        const slot = root.querySelector<HTMLElement>(
          `[data-preview="${CSS.escape(field.name)}"]`
        );
        if (!zone || !input || !slot) continue;

        const label = zone.querySelector<HTMLElement>('[data-drop-label]')!;
        const announce = (): void => {
          const file = input.files?.[0] ?? null;
          label.textContent = file
            ? file.name
            : 'Drop a file here, or click to choose one';
          slot.replaceChildren();
          field.onFile?.(file, slot);
        };

        input.addEventListener('change', announce);
        zone.addEventListener('dragover', (e) => {
          e.preventDefault();
          zone.classList.add('border-primary');
        });
        zone.addEventListener('dragleave', () => zone.classList.remove('border-primary'));
        zone.addEventListener('drop', (e) => {
          e.preventDefault();
          zone.classList.remove('border-primary');
          const dropped = e.dataTransfer?.files?.[0];
          if (!dropped) return;
          const transfer = new DataTransfer();
          transfer.items.add(dropped);
          input.files = transfer.files;
          announce();
          syncButtons();
        });
      }

      const clearErrors = (): void => {
        banner.classList.add('hidden');
        banner.textContent = '';
        box.querySelectorAll<HTMLElement>('[data-error]').forEach((el) => {
          el.textContent = '';
          el.classList.add('hidden');
        });
      };

      const showFieldErrors = (fields: Record<string, string>): void => {
        for (const [name, message] of Object.entries(fields)) {
          const el = box.querySelector<HTMLElement>(`[data-error="${CSS.escape(name)}"]`);
          if (el) {
            el.textContent = message;
            el.classList.remove('hidden');
          } else {
            // A field the form does not render still has to be reported, or a
            // save fails with nothing on screen to explain it.
            banner.textContent = `${name}: ${message}`;
            banner.classList.remove('hidden');
          }
        }
      };

      const isDirty = (): boolean => {
        const now = readValues(root, options.fields);
        return options.fields.some((f) => now[f.name] !== initial[f.name]);
      };

      const syncButtons = (): void => {
        const dirty = isDirty();
        saveBtn.disabled = !dirty && !options.allowPristine;
        revertBtn.disabled = !dirty;
        syncVisibility();
      };

      /**
       * `showModal` re-enables every button once an action that kept the modal
       * open resolves, which would leave Save clickable on a form nobody has
       * touched. A timeout rather than a microtask: the re-enable happens in
       * the continuation of an `await`, so anything queued earlier runs first.
       */
      const resyncAfterAction = (): void => {
        setTimeout(syncButtons, 0);
      };

      /** True keeps the modal open, which every outcome but a success wants. */
      save = async (): Promise<boolean> => {
        clearErrors();
        const values = readValues(root, options.fields);

        const local = options.validate?.(values);
        if (local && Object.keys(local).length) {
          showFieldErrors(local);
          resyncAfterAction();
          return true;
        }

        try {
          result = await options.submit(values, readFiles(root, options.fields));
          return false;
        } catch (err) {
          // The page is already reloading; there is nothing useful to show.
          if (err instanceof SessionExpiredError) return true;
          if (err instanceof ApiError && err.status === 422 && Object.keys(err.fields).length) {
            showFieldErrors(err.fields);
          } else if (err instanceof ApiError && err.status === 409 && options.conflictField) {
            showFieldErrors({ [options.conflictField]: err.message });
          } else {
            banner.textContent = err instanceof Error ? err.message : String(err);
            banner.classList.remove('hidden');
          }
          resyncAfterAction();
          return true;
        }
      };

      revert = (): boolean => {
        for (const field of options.fields) {
          const el = root.querySelector<
            HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
          >(`[data-field="${CSS.escape(field.name)}"]`);
          if (!el) continue;
          if (el instanceof HTMLInputElement && el.type === 'checkbox') {
            el.checked = initial[field.name] === 'true';
          } else if (el instanceof HTMLInputElement && el.type === 'file') {
            // A file input's value can only be cleared, never restored, so
            // Revert on one means "un-choose it" — which is what its initial
            // state was in every form that has one.
            el.value = '';
            el.dispatchEvent(new Event('change'));
          } else {
            el.value = initial[field.name];
          }
        }
        clearErrors();
        resyncAfterAction();
        return true;
      };

      root.addEventListener('input', syncButtons);
      root.addEventListener('change', syncButtons);
      syncButtons();

      root.querySelector<HTMLElement>('[autofocus]')?.focus();
    },
  });

  return result;
}
