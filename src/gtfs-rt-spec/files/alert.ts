/**
 * Alert and the three enums it selects from.
 *
 * The reference lists Cause, Effect and SeverityLevel as bare values with no
 * Comment column, so every `description` here is empty by construction and
 * `label` is the only thing a select row has to show.
 */

import type { RTEnumSpec, RTMessageSpec } from '../types';

export const alertSpec: RTMessageSpec = {
  name: 'Alert',
  description:
    'An alert, indicating some sort of incident in the public transit network.',
  fields: [
    {
      name: 'active_period',
      type: 'TimeRange',
      presence: 'Optional',
      cardinality: 'Many',
      description:
        'Time when the alert should be shown to the user. If missing, the alert will be shown as long as it appears in the feed. If multiple ranges are given, the alert will be shown during all of them.',
    },
    {
      name: 'communication_period',
      type: 'TimeRange',
      presence: 'Optional',
      cardinality: 'Many',
      description:
        "Time when the alert should be shown to the user strictly for informative reasons. If missing, the consuming application can decide when it's appropriate to be shown. If multiple ranges are given, the alert will be shown during all of them.",
    },
    {
      name: 'impact_period',
      type: 'TimeRange',
      presence: 'Optional',
      cardinality: 'Many',
      description:
        'Time when the services are affected by the alert. If communication_period is specified, every time interval in impact_period must be fully contained within at least one time interval of communication_period.',
    },
    {
      name: 'informed_entity',
      type: 'EntitySelector',
      presence: 'Required',
      cardinality: 'Many',
      description:
        'Entities whose users we should notify of this alert.  At least one informed_entity must be provided.',
    },
    {
      name: 'cause',
      type: 'Cause',
      presence: 'Conditionally Required',
      cardinality: 'One',
      description:
        'If cause_detail is included, then Cause must also be included.',
      enumName: 'Cause',
    },
    {
      name: 'cause_detail',
      type: 'TranslatedString',
      presence: 'Optional',
      cardinality: 'One',
      description:
        'Description of the cause of the alert that allows for agency-specific language; more specific than the Cause. If cause_detail is included, then Cause must also be included. <br><br>**Caution:** this field is still **experimental**, and subject to change. It may be formally adopted in the future.',
      experimental: true,
    },
    {
      name: 'effect',
      type: 'Effect',
      presence: 'Conditionally Required',
      cardinality: 'One',
      description:
        'If effect_detail is included, then Effect must also be included.',
      enumName: 'Effect',
    },
    {
      name: 'effect_detail',
      type: 'TranslatedString',
      presence: 'Optional',
      cardinality: 'One',
      description:
        'Description of the effect of the alert that allows for agency-specific language; more specific than the Effect. If effect_detail is included, then Effect must also be included. <br><br>**Caution:** this field is still **experimental**, and subject to change. It may be formally adopted in the future.',
      experimental: true,
    },
    {
      name: 'url',
      type: 'TranslatedString',
      presence: 'Optional',
      cardinality: 'One',
      description:
        'The URL which provides additional information about the alert.',
    },
    {
      name: 'header_text',
      type: 'TranslatedString',
      presence: 'Required',
      cardinality: 'One',
      description:
        'Header for the alert. This plain-text string will be highlighted, for example in boldface.',
    },
    {
      name: 'description_text',
      type: 'TranslatedString',
      presence: 'Required',
      cardinality: 'One',
      description:
        'Description for the alert. This plain-text string will be formatted as the body of the alert (or shown on an explicit "expand" request by the user). The information in the description should add to the information of the header.',
    },
    {
      name: 'tts_header_text',
      type: 'TranslatedString',
      presence: 'Optional',
      cardinality: 'One',
      description:
        "Text containing the alert's header to be used for text-to-speech implementations. This field is the text-to-speech version of header_text. It should contain the same information as header_text but formatted such that it can read as text-to-speech (for example, abbreviations removed, numbers spelled out, etc.)",
    },
    {
      name: 'tts_description_text',
      type: 'TranslatedString',
      presence: 'Optional',
      cardinality: 'One',
      description:
        'Text containing a description for the alert to be used for text-to-speech implementations. This field is the text-to-speech version of description_text. It should contain the same information as description_text but formatted such that it can be read as text-to-speech (for example, abbreviations removed, numbers spelled out, etc.)',
    },
    {
      name: 'severity_level',
      type: 'SeverityLevel',
      presence: 'Optional',
      cardinality: 'One',
      description:
        'Severity of the alert.',
      enumName: 'SeverityLevel',
    },
    {
      name: 'image',
      type: 'TranslatedImage',
      presence: 'Optional',
      cardinality: 'One',
      description:
        'TranslatedImage to be displayed along the alert text. Used to explain visually the alert effect of a detour, station closure, etc. The image should enhance the understanding of the alert and must not be the only location of essential information. The following types of images are discouraged : image containing mainly text, marketing or branded images that add no additional information.',
    },
    {
      name: 'image_alternative_text',
      type: 'TranslatedString',
      presence: 'Optional',
      cardinality: 'One',
      description:
        "Text describing the appearance of the linked image in the `image` field (e.g., in case the image can't be displayed or the user can't see the image for accessibility reasons). See the HTML [spec for alt image text](https://html.spec.whatwg.org/#alt).",
    },
  ],
};

export const causeSpec: RTEnumSpec = {
  name: 'Cause',
  description:
    'Cause of this alert.',
  values: [
    {
      value: 'UNKNOWN_CAUSE',
      label: 'Unknown cause',
      description:
        '',
    },
    {
      value: 'OTHER_CAUSE',
      label: 'Other cause',
      description:
        '',
    },
    {
      value: 'TECHNICAL_PROBLEM',
      label: 'Technical problem',
      description:
        '',
    },
    {
      value: 'STRIKE',
      label: 'Strike',
      description:
        '',
    },
    {
      value: 'DEMONSTRATION',
      label: 'Demonstration',
      description:
        '',
    },
    {
      value: 'ACCIDENT',
      label: 'Accident',
      description:
        '',
    },
    {
      value: 'HOLIDAY',
      label: 'Holiday',
      description:
        '',
    },
    {
      value: 'WEATHER',
      label: 'Weather',
      description:
        '',
    },
    {
      value: 'MAINTENANCE',
      label: 'Maintenance',
      description:
        '',
    },
    {
      value: 'CONSTRUCTION',
      label: 'Construction',
      description:
        '',
    },
    {
      value: 'POLICE_ACTIVITY',
      label: 'Police activity',
      description:
        '',
    },
    {
      value: 'MEDICAL_EMERGENCY',
      label: 'Medical emergency',
      description:
        '',
    },
    {
      value: 'SPECIAL_EVENT',
      label: 'Special event',
      description:
        '',
    },
  ],
};

export const effectSpec: RTEnumSpec = {
  name: 'Effect',
  description:
    'The effect of this problem on the affected entity.',
  values: [
    {
      value: 'NO_SERVICE',
      label: 'No service',
      description:
        '',
    },
    {
      value: 'REDUCED_SERVICE',
      label: 'Reduced service',
      description:
        '',
    },
    {
      value: 'SIGNIFICANT_DELAYS',
      label: 'Significant delays',
      description:
        '',
    },
    {
      value: 'DETOUR',
      label: 'Detour',
      description:
        '',
    },
    {
      value: 'ADDITIONAL_SERVICE',
      label: 'Additional service',
      description:
        '',
    },
    {
      value: 'MODIFIED_SERVICE',
      label: 'Modified service',
      description:
        '',
    },
    {
      value: 'OTHER_EFFECT',
      label: 'Other effect',
      description:
        '',
    },
    {
      value: 'UNKNOWN_EFFECT',
      label: 'Unknown effect',
      description:
        '',
    },
    {
      value: 'STOP_MOVED',
      label: 'Stop moved',
      description:
        '',
    },
    {
      value: 'NO_EFFECT',
      label: 'No effect',
      description:
        '',
    },
    {
      value: 'ACCESSIBILITY_ISSUE',
      label: 'Accessibility issue',
      description:
        '',
    },
  ],
};

export const severityLevelSpec: RTEnumSpec = {
  name: 'SeverityLevel',
  description:
    'The severity of the alert.',
  experimental: true,
  values: [
    {
      value: 'UNKNOWN_SEVERITY',
      label: 'Unknown severity',
      description:
        '',
    },
    {
      value: 'INFO',
      label: 'Info',
      description:
        '',
    },
    {
      value: 'WARNING',
      label: 'Warning',
      description:
        '',
    },
    {
      value: 'SEVERE',
      label: 'Severe',
      description:
        '',
    },
  ],
};
