---
name: sc-install
description: "Install or share SI-Coder across Claude Code, Claude.ai, ChatGPT, Codex, Hermes, OpenClaw, or another Agent Skills-compatible runtime. Use the canonical skill directory containing SKILL.md for local/repository installs. Use ZIP for web upload surfaces that document ZIP. Treat .skill as optional only when the target client explicitly supports that extension. Choose the install path by surface and never promise an invocation syntax the product does not support."
---

# sc-install — install SI-Coder on the current AI surface

## Language

Keep durable instructions in English. Reply in the user's language unless they request another language.

## First rule: detect the surface

Do not give every install method. Choose the current surface and give the shortest supported path.

## Claude Code

Preferred full repository install:

```text
/plugin marketplace add rahmanef63/si-coder-agent
/plugin install si-coder@si-coder-marketplace
```

The repository provides `.claude-plugin/marketplace.json` and `.claude-plugin/plugin.json`. The full plugin route installs the SI-Coder skill set and can load the bundled MCP configuration. After install, the main direct invocation is `/sc`.

If the user wants only one skill, Claude's skill installer can install a GitHub skill path instead. Do not replace the full plugin install with a single skill when the user wants the whole SI-Coder system.

## Claude.ai / Claude Web

Use the generated package:

- `dist/sc.zip` — recommended Claude Web upload package (Anthropic documents ZIP upload)
- `dist/sc.skill` — optional ZIP-format archive only for clients that explicitly accept the `.skill` extension

Claude's web Skills UI accepts uploaded custom skills. The current documented flow is Customize → Skills → + → Create skill → Upload a skill. The package is self-contained and bundles the core SI-Coder workflows.

Do not require a VPS or local SC vault for the hosted path. Do not promise `/sc` in Claude web unless the current UI actually exposes slash invocation; Claude can automatically activate installed skills.

## Codex CLI / Codex app

Use the built-in `$skill-installer` and the GitHub repository paths listed in `AI_INSTALL.md`. Core paths:

- `skills/sc`
- `skills/sc-build`
- `skills/sc-all`
- `skills/sc-provider`
- `skills/sc-install`

Codex skill invocation is surface-specific. Use the current Codex skill picker/invocation UX; do not rewrite it as Claude's `/sc`.

Local fallback remains:

```bash
bash install.sh --agent codex
```

Use `--with-mcp` when the user also wants the local SI-Coder MCP server.

## ChatGPT Web

If ChatGPT Skills are available for the user's account/workspace, use the complete `dist/sc.zip` package by default. OpenAI documents skill upload and the `SKILL.md` standard but does not currently require the `.skill` extension. Use `dist/sc.skill` only if that ChatGPT surface explicitly accepts or requests it.

ChatGPT currently documents two invocation modes:

1. automatic use when the skill is relevant, and
2. explicit selection by @-mention / the skill picker.

For a personal Skill upload, the OpenAI display name is `sc`, so say `@sc` (or select the installed skill) when explicit invocation is needed. For the workspace marketplace plugin, the plugin display name remains `SI-Coder`, so explicit plugin selection may appear as `@SI-Coder`. Do **not** promise `/sc` on ChatGPT Web unless OpenAI adds and documents that surface behavior.

ChatGPT also has a Plugin Directory. Plugins can bundle Skills and Apps. Publishing SI-Coder as a public ChatGPT plugin is a separate review/distribution lifecycle from uploading a personal skill package.

## Hermes / OpenClaw / generic local Agent Skills

```bash
bash install.sh --agent hermes
bash install.sh --agent openclaw
bash install.sh --skills-dir /path/to/skills
```

## Package contract

The editable source remains each `skills/<name>/` directory with its required `SKILL.md`. `.zip` and `.skill` are generated transport artifacts, not a second source of truth. Rebuild it with:

```bash
npm run package:skills
```

Never hand-edit `dist/sc.skill`.

## Security

Installing SI-Coder must not copy provider secrets. Credential/account authorization happens separately through secure connected accounts or the local hidden-secret flow.
