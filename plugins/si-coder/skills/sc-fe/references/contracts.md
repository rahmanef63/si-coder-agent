# Shared frontend contracts

Use for inconsistent repeated controls, dense workbenches, Svelte migrations,
or UI/DX/AX regressions. Inspect real screens before changing the system.

## Registry, component, state, tokens

Give each repeated fact one owner:

| Concern | Contract |
| --- | --- |
| IDs, labels, destinations, capabilities | Typed registry/manifest |
| Rendering, keyboard/focus, loading/error/empty behavior | Shared component |
| Selection and navigation | Parent state or canonical URL |
| Spacing, color, density, responsive presentation | Semantic tokens and documented CSS custom properties |
| Backend data and roles | Generated schema/API types and server capabilities |

Do not create a config system for one fixed caller. Extract a component when the
same behavior repeats. Pass typed items, selected ID, callback and content
snippet/slot; keep business queries/mutations in their owning feature.
Derive unions from the registry instead of copying strings into types/tests.

For Svelte 5, use typed `$props`, `$state`, `$derived` and snippets where they
fit the installed runtime. An effect coordinates an external side effect; it is
not a second source of derived state. Preserve the project's adapter and package
manager. A migration must retire duplicated runtime ownership, not only restyle
the old screen. Keep Convex generated APIs in their canonical backend directory.

## Tabs and navigation

Links change addressable destinations; tabs select in-place panels; phase/status
buttons mutate records. Share visual tokens without conflating those semantics.
Use one visual treatment per product contract, with meaningful props such as
stretch/sticky and token-backed CSS variables when consumers need them.

Tabs need stable IDs, tab/panel relationships, one roving tab stop, arrow keys,
Home/End, visible focus and selected state. Prefer manual Enter/Space activation
when panels fetch or mount content; moving focus must not submit changes or lose
form data. Mount only the selected expensive panel. Keep inactive panel targets
available to accessibility APIs according to the chosen implementation.

Responsive tab groups must remain discoverable: wrap or use an explicit overflow
control, not an invisible horizontal rail that hides remaining destinations.
A desktop sidebar, work area and mobile drawer/dock share the same route registry.
Keep one ordinary content scroll owner; modal focus/Escape/restore and safe areas
remain explicit. Repeated long prose belongs behind a useful summary/detail
interaction, with readable text and bounded columns at wide desktop sizes.

## Verification that distinguishes the failure

Render representative 320/390 phone, tablet, desktop and wide-desktop widths;
exercise light/dark themes when both are supported. Resize in the same session.
Test keyboard, back/forward, focus restoration, long labels, permissions and
empty/error states. Ensure task controls remain usable without horizontal
document overflow. Inspect disabled/read-only text contrast manually: automated
accessibility tools may skip it.

A source-string assertion or HTTP 200 is not visual acceptance. A screenshot
without interaction does not prove navigation. The user's failed manual test
remains unresolved until a matching current test succeeds.

For PWA faults, inspect the deployed worker as well as source: clone a Response
before the original is consumed, keep asynchronous cache writes alive with
`event.waitUntil`, bound caching to public static assets and preserve private
route exclusions. Test delayed cache writes while consuming the response.

For anonymous VM/telemetry stacks, identify the script's origin before patching
the product. Compare deployed assets and a clean browser. Do not hide errors or
patch browser prototypes to silence a browser-extension/DevTools problem.

## Operational integration screens

Use a shared provider registry for names, auth methods, capabilities and setup
links. Private forms, account cards and resource pickers consume that contract.
Once a provider is connected, expose supported real actions and resource discovery;
do not leave users manually retyping identifiers that the provider can list.
Separate personal connection capabilities from shared workspace administration,
and apply that same distinction in navigation as well as server authorization.

Use concise service descriptions, balanced responsive columns and real status
counts with accessible chart labels. Keep metadata-only references distinct from
verified credentials. Never invent percentages or success states to fill space.
Associate actual content with tabs; visually adjacent empty panels are insufficient.

For local browser verification, configure the preview's own origin and public demo
settings explicitly. Keep CSRF protections enabled. A read-only fixture must be
able to reach the screen while writes remain server-denied. Separate compilation,
unit/security checks, browser acceptance, remote CI and the live release. Investigate
a concrete failure, fix it and rerun the affected gate; do not repeat unrelated
checks or expand scope while the user is waiting for a release.
