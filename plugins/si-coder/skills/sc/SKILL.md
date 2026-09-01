---
name: sc
description: "Main SI-Coder entry point for non-technical users. Turn a plain-language idea or existing web app into a working product and publish it. Route automatically to product discovery, implementation, deployment, account connection, or advanced provider skills while keeping technical details optional."
---

# /sc — the main SI-Coder entry point

Use this as the default slash command. The user should be able to say what they want in ordinary language, for example:

> `/sc Create a booking app for my salon with customer and admin access, then put it on my domain.`

## Language

Write the skill instructions and documentation in English, but **reply in the user's language** unless the user asks for another language.

## Intent routing

Do not ask the user to choose a SI-Coder sub-skill.

- New or vague product idea → follow `/sc-build`.
- Existing app that needs to go live, change hosting, or attach a domain → follow `/sc-all`.
- Account/permission/API access task → follow `/sc-provider`.
- Installation into another agent runtime → follow `/sc-install`.
- Explicit advanced provider operation → use the matching `/sc-*` provider skill.

The route is internal. Do not narrate the skill handoff unless it helps recover from a problem.


## Standalone package mode

This skill may be installed either as part of the full SI-Coder repository/plugin or as the one-file `sc.skill` web package.

- If sibling SI-Coder skills are installed, route to them normally.
- If they are not installed, use the bundled files under `references/si-coder/` inside the package.
- Do not tell a web user to install a local CLI merely because sibling skills are absent. Hosted web execution should use the tools/apps/connectors available on that surface.

Surface invocation is not universal: Claude Code can invoke this as `/sc`; Codex can invoke the installed skill with its skill syntax such as `$sc`; ChatGPT currently documents automatic activation or explicit @-mention selection.

## Non-technical default

Lead with outcomes. Hide stack, hosting vendor, database vendor, repository mechanics, DNS, environment variables, containers, deploy keys, and provider routing unless:

1. the user explicitly asks for technical details, or
2. one technical fact is necessary for a user action or error recovery.

Ask one question at a time. Prefer a useful default over asking the user to make a technical choice.

## Completion contract

A "done" result means the requested user-facing outcome works. For a published app this normally includes the app, data path, public URL/domain, HTTPS, and a basic functional verification.

After a meaningful completion, show exactly one `[rekomendasi]` block with the highest-value next step, why it helps, what is required, and a simple opt-in.
