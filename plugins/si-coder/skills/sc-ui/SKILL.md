---
name: sc-ui
description: "SI-Coder visual interface quality skill. Design, audit, and refine web UI with strong hierarchy, typography, spacing, color, density, motion, component states, responsive craft, and an anti-AI-slop filter while preserving an existing product's design DNA by default."
use_when: "Use for visual UI design, visual polish, design-system consistency, component styling, layout craft, desktop shell visual structure, responsive visual issues, or anti-slop UI review."
do_not_use_when: "Do not use alone when the primary problem is user flow/usability, developer ergonomics, agent ergonomics, infrastructure, or deployment; route through sc-fe/sc-ux/sc-dx/sc-ax/sc-all as appropriate."
required_tools: []
security_constraints: "Never request or expose credentials. Never copy proprietary assets or pixel-clone a branded interface when a preset/reference style is requested."
references: []
compatibility: "Standalone SI-Coder; host invocation syntax and available tools may vary."
---

# sc-ui — visual craft without AI slop

## Language
Keep durable instructions in English. Reply in the user's language unless requested otherwise.

## Default behavior
Inspect before inventing. If the project already has a coherent UI, preserve its design DNA unless the user explicitly asks for a redesign. Do not reset an existing product to generic defaults.

Before editing, produce an internal Design Read from the available product/code/rendered UI:
- product type and primary jobs,
- audience and expertise,
- platform and viewport priorities,
- hierarchy and information density,
- typography and spacing rhythm,
- surface/border/radius/shadow language,
- color roles and contrast,
- icon and illustration language,
- motion language,
- existing design tokens/components,
- explicit exclusions from the user.

## Anti-slop filter
AI slop is not a specific color or component. It is unearned sameness: choices made because they are common in generated interfaces rather than because they serve the product.

Apply a purpose test to every visible decision: `What user/product job does this choice serve?`

Flag and fix when unjustified:
- cards wrapping every section or nested cards with no hierarchy benefit,
- decorative gradients/glass/blur/noise that do not communicate state or brand,
- excessive pills, badges, rounded rectangles, icon buttons, and floating containers,
- generic centered hero/marketing composition inside an application shell,
- fake metrics, fake social proof, placeholder dashboards, decorative charts, or meaningless activity,
- repeated same-sized modules that flatten hierarchy,
- arbitrary huge headings, low-information whitespace, or over-spacious admin/tool UIs,
- excessive shadows/radii that erase grouping structure,
- animation on everything rather than on state change or spatial continuity,
- hard-coded one-off colors/spacing where project tokens already exist,
- rebuilding a mature design system instead of extending it.

These are detectors, not blanket bans. Keep any pattern that has a clear product, accessibility, or brand reason.

## Visual system contract
Prefer a small coherent system over many local decisions:
1. Typography: clear roles for display/title/body/label/code; readable measure and line height.
2. Spacing: repeatable rhythm; proximity communicates grouping before boxes do.
3. Color: semantic roles before decorative palette; preserve brand tokens.
4. Shape: radii/borders/shadows have explicit hierarchy roles.
5. Density: match task frequency and expertise; tools can be compact, reading surfaces can breathe.
6. Components: all interactive states exist — default, hover where relevant, focus-visible, active/selected, disabled, loading, error.
7. Motion: communicate causality, continuity, feedback, or hierarchy; respect reduced-motion preferences.
8. Responsive behavior: preserve task priority rather than merely stacking desktop rectangles.

## Desktop shell rules
For application/workbench shells, prefer `frame → navigation → primary work area → contextual tools/inspector` over dashboard-card composition. Keep frequent actions visible, secondary actions discoverable, separators aligned, resize behavior intentional, and selected/focus states unmistakable.

Never redesign or modify an explicitly excluded surface. If the user says not to touch mobile navigation, treat it as a hard scope lock.

## Verification gate
Do not call visual work done from code inspection alone. When tools allow it, inspect rendered pixels at representative sizes and verify:
- hierarchy is obvious in a 3-second scan,
- no accidental overflow/clipping/wrapping,
- alignment and divider continuity,
- typography and density consistency,
- component states,
- light/dark theme if supported,
- responsive behavior,
- no new generic/slop patterns introduced.

Report concrete defects and fixes, not subjective praise.