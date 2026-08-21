# GTFS-realtime reference snapshot

`gtfs-realtime-reference.md` is a verbatim copy of the official GTFS-realtime
reference.

- Source: https://raw.githubusercontent.com/google/transit/master/gtfs-realtime/spec/en/reference.md
- Revision: **August 17, 2026**

It is the single source of truth for every message name, field name, type
string, Required value, Cardinality value, description and enum value in
`src/gtfs-rt-spec/`. `pnpm check-rt-spec` diffs the two and fails on any
difference that is not listed in the script's `KNOWN_DIVERGENCES`. It runs from
the pre-commit hook, so drift blocks a commit.

`src/gtfs-rt-spec/` covers only the messages this app edits or displays, not the
whole reference. A message the spec does not declare is not reported; a message
it does declare must match the reference field for field.

## Refreshing the snapshot

1. Re-download the file over `gtfs-realtime-reference.md` and update the
   revision date above and `referenceRevision` in `src/gtfs-rt-spec/index.ts`.
2. Run `pnpm check-rt-spec` for the drift report. `pnpm check-rt-spec Alert
   EntitySelector` restricts it to named messages and enums; `--full` also
   prints the raw reference strings, which is what goes into the spec files.
3. Fix each difference in `src/gtfs-rt-spec/files/*.ts` until the checker exits
   zero. Descriptions, type strings, Required and Cardinality are stored
   verbatim; the curated extras (`label` on an enum value, `gtfsField`,
   `enumName`) are hand-written and are not checked.
4. A new or changed alert enum value also needs `pnpm check-alert-enums`, which
   holds `src/modules/managed-render.ts`'s derived lists against cafe-car's
   `src/cafe_car/alert_enums.py`. The reference wins: cafe-car is what changes.
