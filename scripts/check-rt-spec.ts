#!/usr/bin/env tsx
/**
 * Checks the hand-written spec in src/gtfs-rt-spec/ against the official
 * GTFS-realtime reference snapshot in reference/gtfs-realtime-reference.md.
 *
 * Run with: pnpm check-rt-spec
 *   pnpm check-rt-spec Alert Cause   # restrict to some messages and enums
 *   pnpm check-rt-spec --full        # print the raw reference strings
 *
 * Runs in the pre-commit hook, so any drift from the reference blocks a commit.
 *
 * Unlike coloring-book's check-spec, a reference message the spec does not
 * declare is not a finding: this module covers the messages yard-master edits
 * or displays, not the whole reference. What is declared must match exactly.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gtfsRtSpec } from '../src/gtfs-rt-spec/index';
import type { RTCardinality, RTPresence } from '../src/gtfs-rt-spec/types';

const here = dirname(fileURLToPath(import.meta.url));
export const REFERENCE_PATH = join(here, '..', 'reference', 'gtfs-realtime-reference.md');

type Aspect =
  | 'missing-message'
  | 'message-description'
  | 'missing-field'
  | 'extra-field'
  | 'field-order'
  | 'type'
  | 'presence'
  | 'cardinality'
  | 'description'
  | 'missing-enum'
  | 'enum-description'
  | 'missing-value'
  | 'extra-value'
  | 'value-order'
  | 'value-description';

interface KnownDivergence {
  owner: string;
  member?: string;
  aspect: Aspect;
  reason: string;
}

// Deliberate differences from the reference. Every entry needs a reason.
const KNOWN_DIVERGENCES: KnownDivergence[] = [];

// ─── Normalization ────────────────────────────────────────────────────────────

/**
 * Collapses the incidental differences between a reference string and the same
 * string stored in a TS file: backtick and emphasis markup, whitespace runs,
 * the three <br> spellings, curly quotes and non-breaking spaces.
 */
export function normalizeSpecText(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, '<br>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/ /g, ' ')
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const PRESENCE_VALUES: RTPresence[] = [
  'Required',
  'Optional',
  'Conditionally Required',
  'Conditionally Forbidden',
];

/** The reference writes "Conditionally required" and "Optional" inconsistently. */
function parsePresence(cell: string): RTPresence | null {
  const cleaned = cell.replace(/[*_]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  return PRESENCE_VALUES.find((p) => p.toLowerCase() === cleaned) ?? null;
}

function parseCardinality(cell: string): RTCardinality | null {
  const cleaned = cell.replace(/[*_]/g, '').trim().toLowerCase();
  if (cleaned === 'one') return 'One';
  if (cleaned === 'many') return 'Many';
  return null;
}

/** `[TimeRange](#message-timerange)` is the type `TimeRange`. */
function parseType(cell: string): string {
  const trimmed = cell.replace(/[*_]/g, '').trim();
  const link = trimmed.match(/^\[([^\]]+)\]/);
  return (link ? link[1] : trimmed).replace(/`/g, '').trim();
}

/**
 * A table cell holding a name: `**stop_id**`, `_**EMPTY**_`, `` `id` ``. Only
 * the surrounding emphasis is stripped, since the name itself has underscores.
 */
function parseName(cell: string): string {
  return cell.replace(/`/g, '').replace(/^[\s*_]+/, '').replace(/[\s*_]+$/, '').trim();
}

// ─── Reference parsing ────────────────────────────────────────────────────────

export interface ReferenceField {
  name: string;
  type: string;
  presence: RTPresence | null;
  presenceRaw: string;
  cardinality: RTCardinality | null;
  cardinalityRaw: string;
  description: string;
}

export interface ReferenceValue {
  value: string;
  description: string;
}

export interface ReferenceSection {
  kind: 'message' | 'enum';
  name: string;
  /** 1-based ordinal among sections of the same kind and name. */
  occurrence: number;
  description: string;
  experimental: boolean;
  fields: ReferenceField[];
  values: ReferenceValue[];
}

/**
 * Splits a markdown table row. Pipes never appear in the leading columns, but a
 * description can contain one, so surplus cells are folded back into the last.
 */
function splitRow(line: string, columns: number): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = trimmed.split('|').map((c) => c.trim());
  if (cells.length <= columns) return cells;
  return [...cells.slice(0, columns - 1), cells.slice(columns - 1).join('|').trim()];
}

const SEPARATOR_ROW = /^\|?[\s:|-]+\|?$/;

/** Headings are `## _message_ Alert`, `## _enum_ Cause` or `## _enum OccupancyStatus_`. */
const HEADING = /^##\s+_(message|enum)_?\s+([A-Za-z][A-Za-z0-9]*)_?\s*$/;

export function parseReference(markdown: string): ReferenceSection[] {
  const lines = markdown.split('\n');
  const sections: ReferenceSection[] = [];
  const seen = new Map<string, number>();

  let current: ReferenceSection | null = null;
  let prose: string[] = [];
  let inTable: 'fields' | 'values' | null = null;

  // Prose is kept as written, markup and all; normalization happens at compare
  // time so the stored description is still worth showing to a person.
  const flush = () => {
    if (!current) return;
    current.description = prose
      .join('\n')
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('<br><br>');
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = line.match(HEADING);
    if (heading) {
      flush();
      const kind = heading[1] as 'message' | 'enum';
      const name = heading[2];
      const key = `${kind}:${name}`;
      const occurrence = (seen.get(key) ?? 0) + 1;
      seen.set(key, occurrence);
      current = {
        kind,
        name,
        occurrence,
        description: '',
        experimental: false,
        fields: [],
        values: [],
      };
      sections.push(current);
      prose = [];
      inTable = null;
      continue;
    }
    if (!current) continue;

    if (line.startsWith('## ') || line.startsWith('# ')) {
      // A heading this parser does not recognize still ends the prose block.
      flush();
      current = null;
      continue;
    }

    if (line.trim().startsWith('|')) {
      if (SEPARATOR_ROW.test(line.trim())) continue;
      const header = splitRow(line, 5).join(' ').replace(/[*_`]/g, '').trim().toLowerCase();
      if (header.includes('field name')) {
        inTable = 'fields';
        continue;
      }
      if (/^value(\s+comment)?$/.test(header)) {
        inTable = 'values';
        continue;
      }
      if (inTable === 'fields') {
        const [nameCell, typeCell, requiredCell, cardinalityCell, descriptionCell] = splitRow(
          line,
          5
        );
        if (!nameCell) continue;
        current.fields.push({
          name: parseName(nameCell),
          type: parseType(typeCell ?? ''),
          presence: parsePresence(requiredCell ?? ''),
          presenceRaw: (requiredCell ?? '').trim(),
          cardinality: parseCardinality(cardinalityCell ?? ''),
          cardinalityRaw: (cardinalityCell ?? '').trim(),
          description: (descriptionCell ?? '').trim(),
        });
      } else if (inTable === 'values') {
        const [valueCell, commentCell] = splitRow(line, 2);
        if (!valueCell) continue;
        current.values.push({
          value: parseName(valueCell),
          description: (commentCell ?? '').trim(),
        });
      }
      continue;
    }

    if (!line.trim()) {
      if (prose.length > 0) prose.push('');
      continue;
    }
    if (/^\*{2,3}(Fields|Values)\*{2,3}$/i.test(line.trim())) continue;
    if (/^#{3,4}\s+Values\s*$/i.test(line.trim())) continue;
    if (/^\*\*Caution:\*\*/.test(line.trim())) {
      current.experimental = true;
      continue;
    }
    if (inTable) continue; // Prose after a table belongs to nothing.
    prose.push(line.trim());
  }
  flush();
  return sections;
}

// ─── Comparison ───────────────────────────────────────────────────────────────

interface Finding {
  owner: string;
  member?: string;
  aspect: Aspect;
  detail: string;
  reference?: string;
  local?: string;
}

function isKnown(finding: Finding): boolean {
  return KNOWN_DIVERGENCES.some(
    (d) => d.owner === finding.owner && d.member === finding.member && d.aspect === finding.aspect
  );
}

function compareText(
  findings: Finding[],
  owner: string,
  member: string | undefined,
  aspect: Aspect,
  reference: string,
  local: string
): void {
  if (normalizeSpecText(reference) === normalizeSpecText(local)) return;
  findings.push({ owner, member, aspect, detail: 'differs from the reference', reference, local });
}

function findSection(
  sections: ReferenceSection[],
  kind: 'message' | 'enum',
  name: string,
  occurrence: number
): ReferenceSection | undefined {
  return sections.find(
    (s) => s.kind === kind && s.name === name && s.occurrence === occurrence
  );
}

export function compare(sections: ReferenceSection[], only: Set<string>): Finding[] {
  const findings: Finding[] = [];
  const wanted = (name: string) => only.size === 0 || only.has(name);

  for (const message of gtfsRtSpec.messages) {
    if (!wanted(message.name)) continue;
    const reference = findSection(sections, 'message', message.name, 1);
    if (!reference) {
      findings.push({
        owner: message.name,
        aspect: 'missing-message',
        detail: 'the reference has no message by this name',
      });
      continue;
    }
    compareText(
      findings,
      message.name,
      undefined,
      'message-description',
      reference.description,
      message.description
    );

    const referenceNames = reference.fields.map((f) => f.name);
    const localNames = message.fields.map((f) => f.name);
    for (const name of referenceNames) {
      if (!localNames.includes(name)) {
        findings.push({
          owner: message.name,
          member: name,
          aspect: 'missing-field',
          detail: 'in the reference, not in the spec',
        });
      }
    }
    for (const name of localNames) {
      if (!referenceNames.includes(name)) {
        findings.push({
          owner: message.name,
          member: name,
          aspect: 'extra-field',
          detail: 'in the spec, not in the reference',
        });
      }
    }
    const shared = localNames.filter((n) => referenceNames.includes(n));
    const sharedReference = referenceNames.filter((n) => localNames.includes(n));
    if (shared.join(',') !== sharedReference.join(',')) {
      findings.push({
        owner: message.name,
        aspect: 'field-order',
        detail: 'field order differs from the reference',
        reference: sharedReference.join(', '),
        local: shared.join(', '),
      });
    }

    for (const field of message.fields) {
      const referenceField = reference.fields.find((f) => f.name === field.name);
      if (!referenceField) continue;
      if (referenceField.type !== field.type) {
        findings.push({
          owner: message.name,
          member: field.name,
          aspect: 'type',
          detail: 'type differs',
          reference: referenceField.type,
          local: field.type,
        });
      }
      if (referenceField.presence !== field.presence) {
        findings.push({
          owner: message.name,
          member: field.name,
          aspect: 'presence',
          detail: 'Required differs',
          reference: referenceField.presence ?? `unparsed: ${referenceField.presenceRaw}`,
          local: field.presence,
        });
      }
      if (referenceField.cardinality !== field.cardinality) {
        findings.push({
          owner: message.name,
          member: field.name,
          aspect: 'cardinality',
          detail: 'Cardinality differs',
          reference: referenceField.cardinality ?? `unparsed: ${referenceField.cardinalityRaw}`,
          local: field.cardinality,
        });
      }
      compareText(
        findings,
        message.name,
        field.name,
        'description',
        referenceField.description,
        field.description
      );
    }
  }

  for (const enumSpec of gtfsRtSpec.enums) {
    if (!wanted(enumSpec.name)) continue;
    const reference = findSection(
      sections,
      'enum',
      enumSpec.name,
      enumSpec.referenceOccurrence ?? 1
    );
    if (!reference) {
      findings.push({
        owner: enumSpec.name,
        aspect: 'missing-enum',
        detail: 'the reference has no enum by this name',
      });
      continue;
    }
    compareText(
      findings,
      enumSpec.name,
      undefined,
      'enum-description',
      reference.description,
      enumSpec.description
    );

    const referenceValues = reference.values.map((v) => v.value);
    const localValues = enumSpec.values.map((v) => v.value);
    for (const value of referenceValues) {
      if (!localValues.includes(value)) {
        findings.push({
          owner: enumSpec.name,
          member: value,
          aspect: 'missing-value',
          detail: 'in the reference, not in the spec',
        });
      }
    }
    for (const value of localValues) {
      if (!referenceValues.includes(value)) {
        findings.push({
          owner: enumSpec.name,
          member: value,
          aspect: 'extra-value',
          detail: 'in the spec, not in the reference',
        });
      }
    }
    if (localValues.join(',') !== referenceValues.join(',')) {
      findings.push({
        owner: enumSpec.name,
        aspect: 'value-order',
        detail: 'value order differs from the reference',
        reference: referenceValues.join(', '),
        local: localValues.join(', '),
      });
    }
    for (const value of enumSpec.values) {
      const referenceValue = reference.values.find((v) => v.value === value.value);
      if (!referenceValue) continue;
      compareText(
        findings,
        enumSpec.name,
        value.value,
        'value-description',
        referenceValue.description,
        value.description
      );
    }
  }

  return findings;
}

// ─── Report ───────────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  const full = args.includes('--full');
  const only = new Set(args.filter((a) => !a.startsWith('--')));

  const sections = parseReference(readFileSync(REFERENCE_PATH, 'utf8'));
  const findings = compare(sections, only).filter((f) => !isKnown(f));

  if (full) {
    for (const section of sections) {
      if (only.size > 0 && !only.has(section.name)) continue;
      console.log(`\n── ${section.kind} ${section.name} ──`);
      console.log(section.description);
      for (const field of section.fields) {
        console.log(
          `  ${field.name} | ${field.type} | ${field.presenceRaw} | ${field.cardinalityRaw}`
        );
        console.log(`    ${field.description}`);
      }
      for (const value of section.values) {
        console.log(`  ${value.value}${value.description ? ` | ${value.description}` : ''}`);
      }
    }
  }

  const covered =
    gtfsRtSpec.messages.length + gtfsRtSpec.enums.length;
  if (findings.length === 0) {
    console.log(
      `check-rt-spec: ${covered} messages and enums match the reference ` +
        `(revision ${gtfsRtSpec.referenceRevision}).`
    );
    return;
  }

  for (const finding of findings) {
    const where = finding.member ? `${finding.owner}.${finding.member}` : finding.owner;
    console.log(`\n${where} [${finding.aspect}] ${finding.detail}`);
    if (finding.reference !== undefined) console.log(`  reference: ${finding.reference}`);
    if (finding.local !== undefined) console.log(`  spec:      ${finding.local}`);
  }
  console.log(`\ncheck-rt-spec: ${findings.length} difference(s) from the reference.`);
  if (!full) console.log('Re-run with --full for the raw reference strings.');
  process.exitCode = 1;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
