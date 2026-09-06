---
name: sc-dx
description: "SI-Coder developer experience skill for frontend codebases: fast orientation, predictable project structure, coherent component APIs, design-token reuse, actionable build/test errors, safe local changes, debugging ergonomics, documentation, and low-friction verification."
use_when: "Use for frontend developer ergonomics, project structure, component API quality, naming, design-token architecture, setup/build/test/debug loops, maintainability, or contributor documentation."
do_not_use_when: "Do not use alone for visual polish, human usability, agent ergonomics, infrastructure, or deployment; route through sc-fe/sc-ui/sc-ux/sc-ax/sc-all as appropriate."
required_tools: []
security_constraints: "Never place secrets in examples, logs, fixtures, generated docs, shell history, or client bundles."
references: []
compatibility: "Standalone SI-Coder; host invocation syntax and available tools may vary."
---

# sc-dx — make the frontend easy to understand, change, debug, and verify

## Language
Keep durable instructions in English. Reply in the user's language unless requested otherwise.

## DX objective
Minimize four times without sacrificing correctness:
`time-to-understand → time-to-change → time-to-debug → time-to-verify`.

## Inspect first
Before refactoring, identify:
- framework/runtime/package manager,
- source/layout boundaries,
- component and design-system locations,
- state/data ownership,
- CSS/token strategy,
- build/test/lint/typecheck commands,
- local environment requirements,
- generated files and canonical sources,
- ownership or scope constraints.

Do not reorganize a functioning project merely to match a favorite template.

## Frontend DX rules
1. Canonical source is explicit. Generated copies/artifacts must say how they are regenerated.
2. Reuse tokens/components before creating near-duplicates.
3. Prefer semantic component APIs over prop soups and boolean combinations that can represent impossible states.
4. Keep naming boring and searchable. File/component/action names should reveal purpose.
5. Keep layout/style primitives composable; avoid scattered magic numbers and repeated one-off values when a token/variable already exists.
6. Separate product state, view state, and transient interaction state when that distinction improves debugging.
7. Errors are actionable: state what failed, where, why when known, and the next recovery action.
8. Commands are predictable, scriptable, and non-destructive by default.
9. Build/test feedback should identify the smallest useful failure boundary.
10. Do not hide important side effects behind innocent-looking helpers.
11. Document unusual constraints close to the code or canonical project knowledge, not in tribal memory.
12. Preserve existing conventions unless changing them measurably improves the repository.

## Component contract
For reusable UI components, prefer:
- clear required vs optional inputs,
- controlled/uncontrolled behavior only when needed and documented,
- semantic variants rather than arbitrary style knobs,
- typed/validated events and state transitions,
- accessible defaults,
- testable deterministic behavior,
- escape hatches that are explicit rather than accidental.

## Design-system DX
A design system should reduce decisions, not create another layer to fight. Keep token roles small and semantic. Prefer existing CSS custom properties/theme tokens. Avoid hard-coded colors, radius, spacing, z-index, and animation values repeated across features when a shared role exists.

## Change workflow
For substantial frontend work:
`inspect → smallest coherent plan → edit → format/lint/typecheck → targeted tests → build → rendered/interaction verification`.

Do not mark work complete because compilation passed; DX verification and user-facing verification are separate.

## Output
When reporting DX issues, use `friction → evidence → proposed contract → migration risk → verification`. Prioritize fixes that remove repeated future cost.