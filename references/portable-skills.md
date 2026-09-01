# Portable SI-Coder distribution

SI-Coder separates **source format**, **distribution artifact**, and **invocation syntax**.

- Canonical source: `skills/<name>/SKILL.md`.
- Web/import artifact: `dist/sc.skill` (ZIP format) plus `dist/sc.zip` compatibility copy.
- Invocation syntax belongs to the client, not to the Agent Skills standard.

## Claude Code

The repository is a Claude Code marketplace. Preferred install:

```text
/plugin marketplace add rahmanef63/si-coder-agent
/plugin install si-coder@si-coder-marketplace
```

Claude Code supports direct skill invocation such as `/sc`. The filesystem source remains `SKILL.md`.

## Claude.ai / Claude Web

Upload `dist/sc.skill` through the Skills UI; use `dist/sc.zip` if the picker filters for ZIP. The `.skill` artifact is a ZIP package containing the `sc/` skill directory and its required `SKILL.md`. The web package bundles core SI-Coder workflows so one upload is sufficient.

Hosted execution does not require a VPS or local SC vault. Use the connected tools/apps available to the web surface. Claude may activate installed skills automatically; do not assume a slash picker unless the current UI exposes it.

## Codex

Codex follows Agent Skills and includes a `$skill-installer` that can install GitHub repository paths. `AI_INSTALL.md` lists the core SI-Coder paths. Codex invocation is not Claude slash syntax; use the current Codex skill/plugin syntax such as `$sc` when explicit selection is required.

## ChatGPT Web

For managed workspaces, OpenAI supports importing a plugin marketplace directly from a GitHub repository. SI-Coder provides `.agents/plugins/marketplace.json` pointing to a skill-only `plugins/si-coder/` package. An admin can import `https://github.com/rahmanef63/si-coder-agent` from Workspace settings → Plugins → Add → Import marketplace; daily sync keeps it current.

For personal Skills, OpenAI Skills follow the Agent Skills open standard and can be uploaded when Skills are available for the account/workspace. Install `dist/sc.skill` (or `dist/sc.zip`). ChatGPT can activate a relevant skill automatically; OpenAI Academy documents explicit @-mention selection, for example `@SI-Coder`.

The skill-only OpenAI plugin intentionally omits `.mcp.json`; OpenAI notes that imported plugins declaring MCP servers can be labeled Desktop-only and therefore cannot run in ChatGPT Web.

## Local fallback installer

```bash
bash install.sh --agent claude
bash install.sh --agent codex
bash install.sh --agent hermes
bash install.sh --agent openclaw
bash install.sh --agent all
```

These link the canonical skill folders into the runtime's local skills directory.

## Runtime routing after installation

| Runtime | Default infrastructure behavior |
|---|---|
| Hosted web/chat | managed/connected-account path; no VPS question |
| Local, VPS unknown | ask once whether to use an existing server or managed hosting |
| Local, no VPS | managed path |
| Local + VPS | own-server path |

Installation and provider authorization are separate. Never move raw provider secrets as part of installing a skill or plugin.
