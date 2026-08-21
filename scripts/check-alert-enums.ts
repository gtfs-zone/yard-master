#!/usr/bin/env tsx
/**
 * Holds cafe-car's `alert_enums.py` to the alert enums this app derives from
 * `src/gtfs-rt-spec/`.
 *
 * The two have to agree in both directions. A value the spec allows but the API
 * rejects is a 422 somebody hits after filling in a form; a value the API
 * accepts but the spec omits is a row the panel cannot label. The reference
 * wins when they disagree, so the fix for a difference reported here is almost
 * always a change to cafe-car.
 *
 * A row whose sibling repo is not checked out is skipped and the run exits 0,
 * the same way `vendor-check.ts` does, so CI is never blocked by it.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALERT_CAUSES, ALERT_EFFECTS, ALERT_SEVERITIES } from '../src/modules/managed-render';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENUMS_PATH = resolve(repoRoot, '..', 'cafe-car', 'src', 'cafe_car', 'alert_enums.py');

/** The string members of `Name = Literal[...]`, in source order. */
function parseLiteral(source: string, name: string): string[] | null {
  const start = source.indexOf(`${name} = Literal[`);
  if (start === -1) return null;
  const open = source.indexOf('[', start);
  const close = source.indexOf(']', open);
  if (close === -1) return null;
  return [...source.slice(open + 1, close).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

interface Check {
  literal: string;
  local: readonly string[];
}

const CHECKS: Check[] = [
  { literal: 'AlertCause', local: ALERT_CAUSES },
  { literal: 'AlertEffect', local: ALERT_EFFECTS },
  { literal: 'AlertSeverity', local: ALERT_SEVERITIES },
];

function main(): void {
  if (!existsSync(ENUMS_PATH)) {
    console.log('check-alert-enums: cafe-car is not checked out beside this repo, skipping.');
    return;
  }
  const source = readFileSync(ENUMS_PATH, 'utf8');
  const problems: string[] = [];

  for (const { literal, local } of CHECKS) {
    const remote = parseLiteral(source, literal);
    if (!remote) {
      problems.push(`${literal}: no \`${literal} = Literal[...]\` in alert_enums.py`);
      continue;
    }
    for (const value of local) {
      if (!remote.includes(value)) {
        problems.push(`${literal}: ${value} is in the spec and not in cafe-car`);
      }
    }
    for (const value of remote) {
      if (!local.includes(value)) {
        problems.push(`${literal}: ${value} is in cafe-car and not in the spec`);
      }
    }
    if (remote.join(',') !== local.join(',') && problems.length === 0) {
      problems.push(
        `${literal}: same values, different order\n  spec:     ${local.join(', ')}\n  cafe-car: ${remote.join(', ')}`
      );
    }
  }

  if (problems.length === 0) {
    console.log(
      `check-alert-enums: ${CHECKS.length} enums match cafe-car's alert_enums.py ` +
        `(${ALERT_CAUSES.length} causes, ${ALERT_EFFECTS.length} effects, ${ALERT_SEVERITIES.length} severities).`
    );
    return;
  }

  for (const problem of problems) console.log(problem);
  console.log(
    `\ncheck-alert-enums: ${problems.length} difference(s). The reference wins: ` +
      'change cafe-car unless the spec is the one that is wrong.'
  );
  process.exitCode = 1;
}

main();
