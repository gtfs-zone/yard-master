/**
 * TranslatedString and the Translation it repeats.
 *
 * The API stores one string per alert text field rather than a translation
 * list, so these are here for the field descriptions rather than for a form.
 */

import type { RTMessageSpec } from '../types';

export const translatedStringSpec: RTMessageSpec = {
  name: 'TranslatedString',
  description:
    'An internationalized message containing per-language versions of a snippet of text or a URL. One of the strings from a message will be picked up. The resolution proceeds as follows: If the UI language matches the language code of a translation, the first matching translation is picked. If a default UI language (e.g., English) matches the language code of a translation, the first matching translation is picked. If some translation has an unspecified language code, that translation is picked.',
  fields: [
    {
      name: 'translation',
      type: 'Translation',
      presence: 'Required',
      cardinality: 'Many',
      description:
        'At least one translation must be provided.',
    },
  ],
};

export const translationSpec: RTMessageSpec = {
  name: 'Translation',
  description:
    'A localized string mapped to a language.',
  fields: [
    {
      name: 'text',
      type: 'string',
      presence: 'Required',
      cardinality: 'One',
      description:
        'A UTF-8 string containing the message.',
    },
    {
      name: 'language',
      type: 'string',
      presence: 'Conditionally Required',
      cardinality: 'One',
      description:
        'BCP-47 language code. Can be omitted if the language is unknown or if no internationalization is done at all for the feed. At most one translation is allowed to have an unspecified language tag - if there is more than one translation, the language must be provided.',
    },
  ],
};
