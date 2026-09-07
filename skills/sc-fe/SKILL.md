---
name: sc-fe
description: "SI-Coder frontend quality orchestrator. Audit, design, implement, and verify frontend work across UI, UX, DX, and Agent Experience (AX), with reusable design presets/profiles such as --apple or --workbench and automatic preservation of existing design DNA by default."
use_when: "Use for any substantial frontend build, redesign, desktop shell/workbench, UI/UX quality pass, responsive frontend change, or combined UI+UX+DX+AX audit."
do_not_use_when: "Do not use for backend/infrastructure-only work with no user-facing or frontend developer/agent surface. Provider/deployment mechanics remain owned by sc-all and provider skills."
required_tools: []
security_constraints: "Never request or expose credentials. Named presets are principle references only: do not copy proprietary assets, brand trade dress, or pixel-clone another product."
references: ["references/profiles.md", "references/contracts.md"]
compatibility: "Standalone SI-Coder; host invocation syntax and available tools may vary."
---

# sc-fe — frontend quality orchestrator

## Language
Keep durable instructions in English. Reply in the user's language unless requested otherwise.

## Ownership
`sc-fe` composes four quality axes:
- `sc-ui` — visual hierarchy/craft/design system/anti-slop,
- `sc-ux` — human usability/accessibility/interaction/recovery,
- `sc-dx` — developer ergonomics/maintainability/debug/verification,
- `sc-ax` — Agent Experience/discoverability/operability/resume/context efficiency.

Normal users do not need to choose a sub-skill. Route internally. Direct sub-skill invocation remains valid for focused audits.

## Invocation and flags
Host syntax varies, but on slash-capable hosts use patterns such as:

```text
/sc-fe improve the desktop shell
/sc-fe --apple improve settings
/sc-fe --workbench audit the desktop shell
/sc-fe --profile baton-desktop refine the inspector
/sc-fe --save-profile baton-desktop
/sc-fe --apple --density compact --motion subtle
/sc-fe --audit --strict
```

Supported semantic flags:
- `--apple` → shorthand for `--preset apple`.
- `--workbench`, `--linear`, `--notion`, `--vercel`, `--material`, `--editorial`, `--terminal` → shorthand named presets.
- `--preset <name>` → built-in principle preset.
- `--profile <name>` → load a project-defined reusable frontend profile.
- `--save-profile <name>` → extract current design DNA and save a reusable project profile when filesystem write access exists.
- `--existing` → explicitly preserve/extend existing design DNA. This is already the default for an existing coherent product.
- `--fresh` → allow a new design direction when no existing profile should constrain it.
- `--density compact|comfortable|spacious`.
- `--motion none|subtle|expressive`.
- `--platform desktop|mobile|responsive`.
- `--audit` → report first; do not make cosmetic invention merely to create work.
- `--strict` → treat UI/UX/DX/AX verification failures as completion blockers when applicable.
- `--technical` → expose implementation details normally kept internal.

Unknown flags must not be silently invented. Explain unsupported input or treat it as plain-language intent.

## Profile resolution order
Resolve the frontend language in this order:
1. explicit user scope/exclusions and functional requirements,
2. explicit flag overrides (`--density`, `--motion`, platform, etc.),
3. explicit named project `--profile`,
4. explicit built-in `--preset` / shorthand such as `--apple`,
5. coherent existing project design DNA,
6. product/platform defaults.

An explicit preset does not erase functional requirements or accessibility. An existing coherent product wins over generic SI-Coder taste unless the user asks to redesign it.

If multiple references conflict, prefer the more explicit user instruction, then product function, then accessibility/usability, then aesthetic preference.

Read `references/profiles.md` for preset meanings and the reusable profile contract.

## Existing UI learning
When a project already has UI/UX and the user has not asked for a new direction:
1. inspect rendered screens when possible,
2. inspect tokens/theme/components/layout primitives,
3. identify repeated visual and interaction rules,
4. distinguish intentional system from accidental inconsistency,
5. preserve the intentional rules,
6. fix inconsistencies against that system instead of importing a new template.

`--save-profile <name>` stores the extracted contract at `.sc/frontend/profiles/<name>.json` when project writes are allowed. Never store screenshots, copyrighted assets, secrets, or huge generated dumps in the profile.

For repeated-control inconsistencies, workbench responsiveness or Svelte runtime
migrations, read [shared frontend contracts](references/contracts.md). Resolve
registry, component, state and token ownership before editing individual screens.

## Scope lock
Treat user exclusions as hard boundaries. Example: if the user says `mobile nav dock jangan disentuh`, do not edit it, its styles, its behavior, or shared abstractions in a way that changes it. If a required shared change risks the excluded surface, isolate the implementation or report the conflict.

## Workflow
For substantial frontend work:

### 1. Inspect
Read project structure, design system, current behavior, and rendered UI where possible. Do not redesign from filenames alone.

### 2. Design Read
Internally summarize product type, user jobs, platform, density, hierarchy, brand/design DNA, state model, constraints, and profile/preset resolution.

### 3. Audit four axes
Score/prioritize defects by impact, not by how easy they are to make pretty:
- UI: hierarchy/craft/consistency/anti-slop,
- UX: task flow/feedback/accessibility/recovery,
- DX: code/system/debug/change friction,
- AX: agent orientation/tool semantics/resume/context waste.

### 4. Implement smallest coherent set
Fix root system issues before local decoration. Reuse current components/tokens. Avoid broad rewrites when targeted changes solve the actual problem.

### 5. Verify
Frontend completion requires more than compilation. When tools allow:
- format/lint/typecheck/tests/build,
- inspect rendered pixels at representative viewports,
- test key interactions and keyboard path,
- verify loading/empty/error states,
- confirm no excluded surface changed,
- verify responsive resize behavior,
- verify AX/DX contracts when agent/developer surfaces changed.

### 6. Report evidence
Report `problem → change → verification → remaining risk`. Do not claim subjective quality as verified fact.

## Desktop shell default
For application shells, developer tools, admin workbenches, and agent consoles, default to a workbench mental model rather than a marketing dashboard: clear frame/navigation/work-area/contextual-tools regions, dense-but-readable controls, keyboard-first acceleration, visible selection/focus/status, deterministic pane/resize behavior, and restrained decoration.

## Integration with sc-all
When `sc-all` is building/publishing a user-facing app, `sc-all` should delegate frontend quality to `sc-fe` before final production verification. Backend-only or infrastructure-only tasks do not need this gate. Forward any frontend flags/preset/profile named by the user.