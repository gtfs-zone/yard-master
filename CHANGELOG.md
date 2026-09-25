## v0.5.1 (2026-09-25)

### Fix

- **map**: make the focused-vehicle halo a top-level zoom interpolate

### Refactor

- build the shell on interlocking's shared modules

## v0.5.0 (2026-09-22)

### Feat

- point map clicks, follow and search at a fleet's single vehicle
- give each vehicle of a multi-vehicle tracker its own page

## v0.4.0 (2026-09-21)

### Feat

- stack every route direction instead of tabbing between them

### Refactor

- read the realtime half from interlocking
- move five modules into interlocking v2.1.0

## v0.3.1 (2026-09-16)

### Fix

- **css**: scan the interlocking package for Tailwind classes

## v0.3.0 (2026-09-16)

### Feat

- **account**: add sign-out, and drop the vite dev server
- **modals**: hash-route the alerts and help modals, and bind keyboard shortcuts

### Refactor

- consume the 35 shared modules from interlocking
- **map**: drop the route geometry toggle

## v0.2.0 (2026-09-14)

### Feat

- **map**: gate navigation camera moves behind an auto-zoom toggle
- **forms**: shared field markup and a real calendar input
- **navbar**: render the action row from a descriptor list
- **help**: replace the About modal with the shared help modal

### Refactor

- **navbar**: re-vendor the navbar action row through test-track
- **map**: re-sync the layer stack against the shared layer specs
- **map**: re-vendor the basemap control and go globe-only
- **forms**: explain a field in a tooltip, never in helper text

## v0.1.0 (2026-08-27)

### Feat

- **nav**: shared breadcrumb trail, three-state uploads, and the vendoring plan
- **calendar**: timeline-first tabs and coloring-book's scrolling month cell
- **routes**: say Unassigned out loud, with counts to back it up
- **assign**: ask Repeats: Once / Weekly instead of a forever/until radio
- **feed-source**: fetch schedules through cafe-car, same origin
- **feed-page**: drop source_kind from the UI, add link-schedule
- **pages**: the object pages become header, facts, children
- **assign**: the trip picker becomes a field on the rule form
- **forms**: fields render the way the editor renders one
- **ui**: the feed page becomes identity, children, facts
- **nav**: the shell, with sharing and alerts off the navbar
- **ui**: the calendar modal off the nav
- **ui**: assignments rebuilt on the timeline chart
- **ui**: the service view on the timeline chart
- **ui**: the timeline chart
- **ui**: the feed page becomes the feed, and lists become pages
- **ui**: one list-row vocabulary across every page
- **chrome**: move Reload onto the feed page and drop bulk tracker create
- **about**: vendor the About modal and add a header button
- **forms**: spec-driven labels and id combos
- **spec**: import the GTFS-realtime spec as typed data
- **managers**: the people page becomes Managers
- **panel**: one top-level feed page
- **feeds**: upload a schedule zip instead of linking one
- **dev**: the second local door, and boot straight into a feed
- **tracker**: list a tracker's assignments on its page
- **assignments**: the month calendar, the rule editor and the day agenda
- **map**: trackers on the map
- **events**: subscribe to the feed channel and show load status live
- **panel**: writes
- **panel**: the managed pages
- **panel**: the browse tree and the GTFS object pages
- **shell**: the feed switcher, hash state and a navigable app
- repo scaffold and the vendor spine

### Fix

- **pages**: stop the entity-row scrollboxes scrolling sideways
- **forms**: refuse bad feed names client-side and surface whole-object 422s
- **map**: navigate to the tracker id, not the vehicle key
- **forms**: draw a focus ring on the file drop zone

### Refactor

- **nav**: collapse the hierarchy to six page variants
- **vendor**: single upstream and an adopted tier

### Perf

- **bundle**: drop the GTFS-RT decoder, keep its types
