# Install SI-Coder from this repository

This file is written for AI agents that are asked: **"Install this repository for me."**

Repository: `https://github.com/rahmanef63/si-coder-agent`

Detailed human-facing guides live in `docs/install/README.md`. After detecting the current surface, use the matching file under `docs/install/` rather than inventing setup steps.

## Choose the current surface first

### Claude Code

Preferred full install (skills + plugin/MCP bundle):

```text
/plugin marketplace add rahmanef63/si-coder-agent
/plugin install si-coder@si-coder-marketplace
```

Shell equivalents may be used when the installed Claude Code version exposes them. After installation, reload plugins if needed. The main skill is invokable as `/sc` in Claude Code.

For a skill-only install, Anthropic also documents the `skills` installer pattern; install the repository's `sc` skill from `skills/sc` if a plugin install is not desired.

### Codex CLI / Codex app

Use the built-in `$skill-installer`. Install these repository paths from `main`:

- `skills/sc`
- `skills/sc-build`
- `skills/sc-all`
- `skills/sc-provider`
- `skills/sc-install`

The installer can accept GitHub repo paths and install them into the Codex skills directory. Restart/reload Codex if the client requires it. Codex skill invocation uses its own skill syntax (commonly `$sc`) rather than Claude's slash syntax.

### Claude.ai / Claude Web

Anthropic currently documents **ZIP upload** for custom Skills. Use:

- `https://github.com/rahmanef63/si-coder-agent/releases/download/v0.8.4/sc.zip`

Do not default to the `.skill` filename on Claude Web; the official web instructions say to upload a ZIP containing the skill folder.

### ChatGPT Web

**Workspace admin / team install from the repository URL:** import this repository as a plugin marketplace. In ChatGPT: Workspace settings → Plugins → Add → Import marketplace. Set Source to `https://github.com/rahmanef63/si-coder-agent` and leave Path empty. OpenAI will use `.agents/plugins/marketplace.json` and keep it synced from GitHub.

**Personal Skill:** OpenAI defines the skill around `SKILL.md` and documents **Upload from your computer**, but does not currently require a `.skill` extension. Use the complete ZIP package:

- `https://github.com/rahmanef63/si-coder-agent/releases/download/v0.8.4/sc.zip`

The optional `.skill` archive is only for clients that explicitly accept that extension.

OpenAI Skills follow the Agent Skills standard. ChatGPT can automatically use an installed relevant skill; OpenAI Academy also documents explicit skill selection by **@-mention**. Do not promise `/sc` on ChatGPT Web unless that surface explicitly adds slash invocation. For a personal Skill upload, prefer `@sc`; for the workspace plugin, use `@SI-Coder` / the plugin picker when explicit invocation is needed.

### Other Agent Skills clients

Prefer the canonical `skills/sc/` directory containing `SKILL.md`. Use an archive only when the client explicitly asks for a packaged skill; use `.skill` only when that client explicitly supports the extension.

## Security

Never copy provider secrets out of their secure stores just to complete installation. Installing SI-Coder installs workflow instructions and local tooling only; provider authorization remains a separate secure connection step.
