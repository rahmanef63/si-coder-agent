---
name: sc-install
description: "Install or share SI-Coder across Claude Code, Codex/ChatGPT local skills, Hermes, OpenClaw, or another Agent Skills-compatible runtime. Uses the same skills/ SSOT, the Claude plugin manifest, and the bundled secret-safe SC MCP server. Use when a user asks to install SI-Coder skills/plugins or make them available to another agent runtime."
---

# /sc-install — portable Agent Skills + plugin setup

SI-Coder uses one `skills/` tree as the source of truth. Do not fork/copy skill content per agent unless the runtime cannot follow symlinks.


## Hosted Claude Web / ChatGPT chat

Hosted execution does not require a VPS or local SC vault. When the skill is loaded into a hosted chat surface, `/sc` routes the request and `/sc-all` uses the publishing policy directly through secure connected accounts:

`GitHub → Convex Cloud → Vercel → Hostinger DNS → verify`

If Composio is not enabled/connected, guide the user through the secure connector setup. Do not ask for raw API keys. A local installation is only required if the user explicitly wants local/VPS execution.


## Slash skill identities

SI-Coder uses the standard Agent Skills layout: each portable skill is a directory containing `SKILL.md`. Do not create a parallel `.skill` file.

The important identities are:

- `skills/sc/SKILL.md` → `/sc`
- `skills/sc-build/SKILL.md` → `/sc-build`
- `skills/sc-all/SKILL.md` → `/sc-all`
- `skills/sc-provider/SKILL.md` → `/sc-provider`

Claude-style clients can expose installed skill names as slash invocations. Other Agent Skills runtimes may use a different invocation syntax, but the same `SKILL.md` source remains portable.

## Claude Code

Preferred shared/plugin mode:

```bash
claude --plugin-dir /path/to/si-coder-agent
```

The plugin root contains:

- `.claude-plugin/plugin.json`
- `skills/*/SKILL.md`
- `.mcp.json` → bundled local `si-coder` MCP server

Standalone personal install:

```bash
bash install.sh --agent claude
```

## Codex / ChatGPT local Agent Skills

Install the same skill directories into the open Agent Skills location:

```bash
bash install.sh --agent codex
```

This targets `~/.agents/skills`. If the user also wants MCP access, run the installer with `--with-mcp`; it prints or applies the local SC MCP registration when supported by the installed client.

## Hermes / OpenClaw

```bash
bash install.sh --agent hermes
bash install.sh --agent openclaw
```

## All known local runtimes

```bash
bash install.sh --agent all
```

## Custom Agent Skills directory

```bash
bash install.sh --skills-dir /path/to/agent/skills
```

## Safety

Installing skills/MCP must not migrate or copy credential files. SC state remains outside the plugin/repository under `~/.config/si-coder/`.

For hosted surfaces without local filesystem/SC access, use the workflow instructions plus connected accounts for GitHub, Convex, Vercel, and Hostinger. Do not ask the user to bootstrap a local SC GitHub identity in hosted mode.

See `../../references/portable-skills.md` for runtime-specific notes.
