---
name: sc
description: "Main SI-Coder entry point for non-technical users. Turn a plain-language idea or existing web app into a working product and publish it. Route automatically to product discovery, implementation, deployment, account connection, or advanced provider skills while keeping technical details optional."
---

# sc — the main SI-Coder entry point

`sc` is the canonical SI-Coder skill identity. Invocation syntax is chosen by the host product, not by the `.skill` package itself.

Examples:

- ChatGPT Web: `@sc Create a booking app for my salon with customer and admin access, then put it on my domain.` or ask naturally and let ChatGPT select `sc` automatically.
- Claude Code: `/sc Create a booking app for my salon with customer and admin access, then put it on my domain.`

## Language

Write the skill instructions and documentation in English, but **reply in the user's language** unless the user asks for another language.

## Intent routing

Do not ask the user to choose a SI-Coder sub-skill.

- New or vague product idea → follow the `sc-build` skill.
- Existing app that needs to go live, change hosting, or attach a domain → follow the `sc-all` skill.
- Account/permission/API access task → follow the `sc-provider` skill.
- Installation into another agent runtime → follow the `sc-install` skill.
- Explicit advanced provider operation → use the matching `sc-*` provider skill.

The route is internal. Do not narrate the skill handoff unless it helps recover from a problem.


## Standalone package mode

This skill may be installed either as part of the full SI-Coder repository/plugin or as the one-file `sc.skill` web package.

- If sibling SI-Coder skills are installed, route to them normally.
- If they are not installed, use the bundled files under `references/si-coder/` inside the package.
- Do not tell a web user to install a local CLI merely because sibling skills are absent. Hosted web execution should use the tools/apps/connectors available on that surface.

Surface invocation is not universal: Claude Code can invoke this as `/sc`; ChatGPT Web currently documents automatic activation or explicit `@sc` selection; Codex uses its own current skill-selection/invocation UX. A `.skill` file packages the skill but does not register a custom ChatGPT Web slash command.

## Non-technical default

Lead with outcomes. Hide stack, hosting vendor, database vendor, repository mechanics, DNS, environment variables, containers, deploy keys, and provider routing unless:

1. the user explicitly asks for technical details, or
2. one technical fact is necessary for a user action or error recovery.

Ask one question at a time. Prefer a useful default over asking the user to make a technical choice.

## Completion contract

A "done" result means the requested user-facing outcome works. For a published app this normally includes the app, data path, public URL/domain, HTTPS, and a basic functional verification.

After a meaningful completion, show exactly one `[rekomendasi]` block with the highest-value next step, why it helps, what is required, and a simple opt-in.
