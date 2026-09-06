---
name: sc-ux
description: "SI-Coder user experience skill for usable, accessible, predictable web interactions: navigation, information architecture, feedback, keyboard behavior, errors/recovery, forms, loading/empty states, responsive task priority, and desktop workbench ergonomics."
use_when: "Use for user-flow, navigation, interaction, accessibility, cognitive load, feedback/status, keyboard, forms, error recovery, responsive usability, or desktop shell UX problems."
do_not_use_when: "Do not use alone for purely visual styling, developer ergonomics, agent ergonomics, infrastructure, or deployment; route through sc-fe/sc-ui/sc-dx/sc-ax/sc-all as appropriate."
required_tools: []
security_constraints: "Never request or expose credentials. Accessibility and safety-critical states must not be hidden for visual cleanliness."
references: []
compatibility: "Standalone SI-Coder; host invocation syntax and available tools may vary."
---

# sc-ux — usable before impressive

## Language
Keep durable instructions in English. Reply in the user's language unless requested otherwise.

## Core model
Optimize for task completion, comprehension, control, recovery, and accessibility. Do not equate fewer visible controls with better UX; hide complexity only when users can still discover, understand, and recover from actions.

Before changing a flow, identify:
- primary user jobs and frequency,
- user expertise and likely mental model,
- entry points and navigation path,
- current state model,
- irreversible/destructive actions,
- latency and failure points,
- keyboard/touch/pointer requirements,
- accessibility requirements,
- responsive task priority,
- explicit scope exclusions.

## Usability gates
Every important flow should satisfy:
1. Status is visible: users can tell what is happening, what changed, and what is selected.
2. Language matches the user's task, not internal architecture.
3. Users retain control: cancel/back/undo/retry where meaningful.
4. Patterns are consistent across the product unless a difference communicates meaning.
5. Prevent errors before explaining them.
6. Prefer recognition over memory: labels, context, recent choices, and visible affordances beat hidden recall.
7. Frequent tasks are efficient without making first use opaque.
8. Interfaces contain only information/actions that earn their place.
9. Errors explain impact and next recovery action.
10. Help appears near the blocking context rather than as a documentation dump.

## Interaction state contract
Important async/action surfaces must cover applicable states:
`idle → pending → progress → success | error → retry/cancel`.

Data surfaces must cover applicable states:
`loading → populated | empty | error | permission-denied | offline/stale`.

Do not use ambiguous spinners for long operations when meaningful progress/state can be shown.

## Accessibility baseline
Use semantic controls and names. Preserve visible focus. Keyboard users must reach and operate every primary action without pointer-only traps. Do not encode meaning by color alone. Maintain sufficient text/control contrast. Respect reduced motion. Provide non-drag alternatives for required drag interactions. Make touch/pointer targets practical and avoid destructive actions adjacent to frequent controls without separation/confirmation/undo.

## Desktop/workbench UX
For desktop shells and productivity tools:
- keep global navigation, local navigation, work area, and contextual tools conceptually distinct,
- support predictable focus movement between regions,
- use one tab stop for composite toolbars/lists where appropriate and arrow-key navigation inside them,
- preserve user context when opening/closing inspectors, dialogs, and secondary panes,
- make resize/collapse boundaries discoverable,
- remember reasonable layout state when product requirements allow,
- keep primary work visible; do not let chrome dominate the canvas,
- command palettes/shortcuts accelerate frequent actions but do not replace discoverable UI for essential tasks.

## Responsive behavior
Responsive UX is reprioritization, not `desktop columns → one long mobile stack`. Preserve the highest-value task and state. Do not alter an explicitly excluded mobile/navigation surface.

## Verification
When tools allow, test the real flow rather than only reading components:
- first-use path,
- frequent-user path,
- keyboard-only path,
- error/retry path,
- empty/loading path,
- destructive action recovery,
- representative viewport resize,
- deep link/back-forward behavior where relevant.

Record defects as `problem → user impact → fix → verification`.