# Portable skill/plugin installation

SI-Coder skills follow the Agent Skills `SKILL.md` format. The same `skills/` tree is the SSOT.

## Claude Code

- Plugin development/test: `claude --plugin-dir /path/to/si-coder-agent`
- Personal standalone skills: `bash install.sh --agent claude`
- Plugin installs automatically start the bundled `si-coder` MCP server from `.mcp.json`.

## Codex / ChatGPT local skills

- Repo/personal Agent Skills use the open format.
- Install user skills with: `bash install.sh --agent codex`
- The installer links to `~/.agents/skills` and, when the `codex` CLI is available, prints the command for registering the local SC MCP server.

## Hermes / OpenClaw / generic agents

Use `bash install.sh --agent hermes`, `--agent openclaw`, or `--skills-dir /custom/skills`. The installed artifact is still the same `skills/<name>/SKILL.md` source.

## Hosted surfaces without a local SC runtime

The skill remains useful as an orchestration policy, but local SC-vault operations require a machine/runtime. Prefer connected Composio toolkits for Vercel/Convex/Hostinger. GitHub remains an SC-direct deployment policy; if no local SC/Git runtime exists, explain that GitHub bootstrap must happen on a local runner before continuing rather than silently switching identities.
