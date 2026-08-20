/**
 * The two ways this app asks "are you sure".
 *
 * `confirmAction` is for something that can be put back in one step: removing
 * an informed entity, taking a member off a feed, revoking an invite. The cost
 * of a mistake is redoing the action, so a plain confirmation is proportionate.
 *
 * `confirmTyped` is for something that cannot: deleting a feed, a tracker or an
 * alert. It asks for the object's own name to be typed, which is deliberately
 * slower — it makes the reader identify *which* object they are about to lose,
 * and a wrongly-focused panel is exactly the mistake this catches. The button
 * stays disabled until what was typed matches exactly, whitespace trimmed.
 *
 * Both list the consequences rather than asking abstractly. "This also deletes
 * 3 trackers and 2 alerts" is the sentence that stops the wrong delete.
 */

import { showModal } from './modal-utils';
import { escHtml } from './render-utils';

function consequenceList(consequences: string[]): string {
  if (consequences.length === 0) return '';
  return `<ul class="list-disc pl-5 text-xs space-y-1 opacity-80">
    ${consequences.map((c) => `<li>${escHtml(c)}</li>`).join('')}
  </ul>`;
}

export interface ConfirmOptions {
  title: string;
  /** One sentence naming what is about to happen. */
  question: string;
  /** What else goes with it, one line each. */
  consequences?: string[];
  confirmLabel?: string;
}

/** A plain confirmation. Resolves true only if the confirm button was clicked. */
export async function confirmAction(options: ConfirmOptions): Promise<boolean> {
  let confirmed = false;

  await showModal({
    title: escHtml(options.title),
    body: `
      <div class="space-y-3">
        <p class="text-sm">${escHtml(options.question)}</p>
        ${consequenceList(options.consequences ?? [])}
      </div>`,
    actions: [
      { label: 'Cancel', onClick: () => {} },
      {
        label: options.confirmLabel ?? 'Remove',
        className: 'btn-error',
        onClick: () => {
          confirmed = true;
        },
      },
    ],
    escapeAction: 0,
    boxClassName: 'max-w-md',
  });

  return confirmed;
}

export interface ConfirmTypedOptions extends ConfirmOptions {
  /** What has to be typed back, which is the object's own name. */
  phrase: string;
  /** What that phrase is, for the prompt: "feed name", "nickname". */
  phraseLabel?: string;
}

/**
 * A confirmation that has to be typed out. Resolves true only if the phrase
 * matched and the confirm button was then clicked.
 */
export async function confirmTyped(options: ConfirmTypedOptions): Promise<boolean> {
  let confirmed = false;
  const label = options.phraseLabel ?? 'name';

  await showModal({
    title: escHtml(options.title),
    body: `
      <div class="space-y-3">
        <p class="text-sm">${escHtml(options.question)}</p>
        ${consequenceList(options.consequences ?? [])}
        <label class="form-control">
          <span class="label-text text-xs">Type the ${escHtml(label)}
            <span class="font-mono">${escHtml(options.phrase)}</span> to confirm</span>
          <input data-confirm-input class="input input-bordered input-sm w-full"
                 autocomplete="off" autofocus />
        </label>
      </div>`,
    actions: [
      { label: 'Cancel', onClick: () => {} },
      {
        label: options.confirmLabel ?? 'Delete',
        className: 'btn-error',
        onClick: () => {
          confirmed = true;
        },
      },
    ],
    escapeAction: 0,
    boxClassName: 'max-w-md',
    onMount: () => {
      // The innermost modal: a confirmation can be opened from a form.
      const inputs = document.querySelectorAll<HTMLInputElement>(
        '.modal-open [data-confirm-input]'
      );
      const input = inputs[inputs.length - 1];
      const box = input.closest<HTMLElement>('.modal-box')!;
      const confirmBtn = box.querySelectorAll<HTMLButtonElement>('button[data-idx]')[1];

      confirmBtn.disabled = true;
      input.addEventListener('input', () => {
        confirmBtn.disabled = input.value.trim() !== options.phrase;
      });
      input.focus();
    },
  });

  return confirmed;
}
