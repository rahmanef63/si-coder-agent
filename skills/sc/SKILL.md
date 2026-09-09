---
name: sc
description: "Main SI-Coder entry point for non-technical users. Turn a plain-language idea or existing web app into a working product, improve frontend quality across UI/UX/DX/AX, and publish it. Route automatically while keeping technical details optional."
use_when: "Use when the task matches this skill scope: Main SI-Coder entry point for non-technical users. Turn a plain-language idea or existing web app into a working product, improve it, and publish it without making the user choose internal skills."
do_not_use_when: "Do not use when the task is outside this skill scope or a more specific SI-Coder skill owns the explicitly requested outcome."
required_tools: []
security_constraints: "Never request, print, or persist plaintext credentials in chat/tool payloads; use SI-Coder safe credential handoffs."
references: []
compatibility: "Standalone SI-Coder; host invocation syntax and available tools may vary."
---

# sc — the main SI-Coder entry point

`sc` is the canonical SI-Coder skill identity. Invocation syntax is chosen by the host product, not by the `.skill` package itself.

Examples:

- ChatGPT Web: `@sc Create a booking app for my salon with customer and admin access, then put it on my domain.` or ask naturally and let ChatGPT select `sc` automatically.
- Claude Code: `/sc Create a booking app for my salon with customer and admin access, then put it on my domain.`
- Frontend quality on slash-capable hosts: `/sc-fe --workbench improve the desktop shell` or `/sc-fe --apple refine settings`.

## Language

Write the skill instructions and documentation in English, but **reply in the user's language** unless the user asks for another language.

## Intent routing

Do not ask the user to choose a SI-Coder sub-skill.

- New or vague product idea → follow the `sc-build` skill.
- Existing app that needs frontend/UI/UX improvement or any substantial frontend work → follow `sc-fe`.
- Focused visual interface request → `sc-ui` through `sc-fe` unless the user explicitly invokes `sc-ui`.
- Focused usability/accessibility/interaction request → `sc-ux` through `sc-fe` unless explicitly invoked.
- Focused frontend developer-experience request → `sc-dx` through `sc-fe` unless explicitly invoked.
- Focused Agent Experience/tool ergonomics request → `sc-ax` through `sc-fe` unless explicitly invoked.
- Existing app that needs to go live, change hosting, or attach a domain → follow the `sc-all` skill; `sc-all` delegates user-facing frontend quality to `sc-fe` before final verification when applicable.
- Account/permission/API access task → follow the `sc-provider` skill.
- Installation into another agent runtime → follow the `sc-install` skill.
- Explicit advanced provider operation → use the matching `sc-*` provider skill **only when that skill is active/implemented**. Unfinished/stub provider work stays in `sc`/`sc-provider`; explain the limitation instead of routing to a dead-end skill.

Forward frontend flags such as `--apple`, `--workbench`, `--profile <name>`, `--save-profile <name>`, `--density`, `--motion`, `--platform`, `--audit`, and `--strict` to `sc-fe` rather than interpreting them as deployment flags.

The route is internal. Do not narrate the skill handoff unless it helps recover from a problem.

## Standalone package mode

This skill may be installed either as part of the full SI-Coder repository/plugin or as the one-file `sc.skill` web package.

- If sibling SI-Coder skills are installed, route to them normally.
- If they are not installed, use the bundled files under `references/si-coder/` inside the package.
- Do not tell a web user to install a local CLI merely because sibling skills are absent. Hosted web execution should use the tools/apps/connectors available on that surface.

Surface invocation is not universal: Claude Code can invoke this as `/sc`; ChatGPT Web currently documents automatic activation or explicit `@sc` selection; Codex uses its own current skill-selection/invocation UX. A `.skill` file packages the skill but does not register a custom ChatGPT Web slash command.

## Non-technical default

Lead with outcomes. Hide stack, hosting vendor, database vendor, repository mechanics, DNS, environment variables, containers, deploy keys, provider routing, and internal quality-axis routing unless:

1. the user explicitly asks for technical details, or
2. one technical fact is necessary for a user action or error recovery.

Ask one question at a time. Prefer a useful default over asking the user to make a technical choice. Do not ask a question that repository/tool state can answer.

For existing products, preserve coherent UI/UX design DNA by default. Do not replace it with a generic preset unless the user asks for a redesign or explicit preset.

## Project initiation through CI/CD

For launch, domain migration, auth/email setup or CI/CD, read
[the delivery workflow](references/delivery.md) before following the selected
sub-skill. It covers the complete requested outcome, including backend release,
OAuth/legal pages, transactional email, exact revision verification and handoff.
Apply only the services/features the project needs. Resume verified work and
preserve existing architecture and the user's prior authorization.

## Completion contract

A "done" result means the requested user-facing outcome works. For a published app this normally includes the app, data path, public URL/domain, HTTPS, frontend quality verification when applicable, and a basic functional verification.

After a meaningful completion, show exactly one `[rekomendasi]` block with the highest-value next step, why it helps, what is required, and a simple opt-in.
