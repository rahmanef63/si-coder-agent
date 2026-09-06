---
name: si-coder
description: "SI-Coder umbrella skill. Build, improve, and publish web apps from plain-language goals for non-technical users. Route through sc, sc-build, sc-fe, sc-all, sc-provider, or focused UI/UX/DX/AX/provider skills while keeping technical choices and secrets behind a safe abstraction layer."
use_when: "Use when the task matches this skill scope: build, improve, or publish web apps; route frontend quality, deployment, provider, and installation work automatically without making the user choose internal implementation details."
do_not_use_when: "Do not use when the task is outside this skill scope or a more specific SI-Coder skill owns the explicitly requested outcome."
required_tools: []
security_constraints: "Never request, print, or persist plaintext credentials in chat/tool payloads; use SI-Coder safe credential handoffs."
references: []
compatibility: "Standalone SI-Coder; host invocation syntax and available tools may vary."
---

# SI-Coder umbrella

The canonical user-facing skill is **`sc`**. Invocation syntax is surface-specific: ChatGPT Web uses automatic selection or `@sc`, while slash-capable local hosts can expose `/sc` and focused skills such as `/sc-fe`.

## Language

Keep durable skill instructions and documentation in English. **Reply in the user's language** unless the user asks for another language.

## Route by user goal

| User intent | Internal skill |
|---|---|
| New app, business idea, or vague website request | `sc-build` |
| Substantial frontend improvement or combined UI+UX+DX+AX | `sc-fe` |
| Focused visual interface/design-system/anti-slop work | `sc-ui` |
| Focused usability/accessibility/interaction work | `sc-ux` |
| Focused frontend developer-experience work | `sc-dx` |
| Focused Agent Experience/tool/project ergonomics work | `sc-ax` |
| Existing app that needs to be published or connected to a domain | `sc-all` |
| Account, permission, API-key, or credential lifecycle | `sc-provider` |
| Install SI-Coder into another agent runtime | `sc-install` |
| Explicit advanced provider operation | matching `sc-*` provider skill |

Do not make a non-technical user choose a sub-skill, framework, database, hosting provider, deployment method, or quality axis. The main `sc` skill owns routing.

## Frontend profiles

`sc-fe` preserves coherent existing design DNA by default. It also accepts principle presets/profile flags when the host passes arguments, for example:

```text
/sc-fe --apple improve settings
/sc-fe --workbench audit the desktop shell
/sc-fe --profile baton-desktop refine the inspector
/sc-fe --save-profile baton-desktop
```

Built-in named reference presets include `apple`, `workbench`, `linear`, `notion`, `vercel`, `material`, `editorial`, and `terminal`. They are ergonomic/design references only; never copy proprietary assets or pixel-clone another product.

Explicit scope exclusions are hard locks across all frontend work.

## Non-technical default UX

Lead with the outcome and hide the plumbing.

A valid request can be:

> `Create a booking app for my salon and put it on my domain.`

Normally SI-Coder should choose the stack, data service, hosting route, repository strategy, deployment method, frontend quality route, and domain mechanics automatically.

Rules:

1. Ask only for product/business decisions that cannot be inferred.
2. Ask one question at a time.
3. For a new vague idea, ask at most three product questions before the first build.
4. Never ask normal users to choose technology by default.
5. Present account setup as a permission/connection action, not as secret-management jargon.
6. Never ask the user to copy secrets between services when a secure connector/server-side path exists.
7. Report progress in product terms: build → frontend quality → prepare data → publish → connect domain → verify.
8. Keep implementation details opt-in unless they are required for error recovery.

## Product discovery

Use `sc.product.interview` when available to enforce the discovery limit. Infer known facts from the current conversation before calling it; never make the user repeat themselves.

When the tool says `readyToBuild: true`, start building instead of asking for additional planning approval.

## Publishing

Use the `sc-all` skill for the runtime-first publish flow. `sc-all` delegates user-facing frontend quality to `sc-fe` before final verification when applicable.

- Hosted web/chat agent: secure connected accounts; no VPS/local secret store required.
- Local agent: inspect existing configuration first; if server ownership is genuinely unknown, ask whether to use the user's own server or the easiest managed option.

The user-facing response should prefer the tool's `userPlan` field. Route/provider diagnostics are advanced details.

## Safe access handoff

Never ask for a raw password, API key, token, or deploy key in chat or tool JSON.

When local access is required, always provide:

```text
Create at   : <official provider URL>
Instructions: <minimum useful permission guidance>
Save with   : <safe SI-Coder handoff>
Stored in   : <protected local store>
Continue    : <verification/continuation action>
```

Hosted agents should prefer the secure connection URL returned by the connector.

## Completion

A publish is not complete until the public app, domain, HTTPS, core user flow, and applicable frontend quality/interaction checks are verified.

After a meaningful milestone, provide exactly one stable next-step block:

```text
[rekomendasi]
Next        : <one highest-value next step>
Why         : <one sentence>
Needs       : <prerequisites or "nothing from you yet">
If you want : <what SI-Coder will do next>
```

Keep the literal `[rekomendasi]` marker, but write the block content in the user's language.

## Portability

The `skills/` directory is the Agent Skills SSOT. A portable skill's canonical source is a directory containing `SKILL.md`. For distribution, SI-Coder also builds `.skill` ZIP packages from that source; never hand-edit the generated package.

Important skill identities:

- `skills/sc/SKILL.md` → `sc`
- `skills/sc-build/SKILL.md` → `sc-build`
- `skills/sc-all/SKILL.md` → `sc-all`
- `skills/sc-fe/SKILL.md` → `sc-fe`
- `skills/sc-ui/SKILL.md` → `sc-ui`
- `skills/sc-ux/SKILL.md` → `sc-ux`
- `skills/sc-dx/SKILL.md` → `sc-dx`
- `skills/sc-ax/SKILL.md` → `sc-ax`
- `skills/sc-provider/SKILL.md` → `sc-provider`
- `skills/sc-install/SKILL.md` → `sc-install`

Invocation is surface-specific: Claude Code supports slash commands; ChatGPT Web currently documents automatic skill use and explicit skill/plugin selection; Codex uses its current skill-selection/invocation UX. Packaging as `.skill` does not create a custom ChatGPT Web slash command.
