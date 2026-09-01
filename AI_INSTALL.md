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

Do not clone the repository into the web sandbox. Use the prebuilt web package:

- `dist/sc.skill` — distributable `.skill` ZIP package
- `dist/sc.zip` — byte-identical ZIP fallback for upload UIs that explicitly request ZIP
- direct `.skill`: `https://raw.githubusercontent.com/rahmanef63/si-coder-agent/main/dist/sc.skill`
- direct ZIP: `https://raw.githubusercontent.com/rahmanef63/si-coder-agent/main/dist/sc.zip`

Upload the package through Claude's Skills UI. The package is self-contained and bundles the core SI-Coder workflows as references. Claude may activate it automatically; direct slash availability on claude.ai depends on the current surface/UI and is not assumed by this installer contract.

### ChatGPT Web

**Workspace admin / team install from the repository URL:** import this repository as a plugin marketplace. In ChatGPT: Workspace settings → Plugins → Add → Import marketplace. Set Source to `https://github.com/rahmanef63/si-coder-agent` and leave Path empty. OpenAI will use `.agents/plugins/marketplace.json` and keep it synced from GitHub.

**Personal skill fallback:** if ChatGPT Skills are available for the account/workspace, upload `dist/sc.skill`; if the uploader requires a conventional archive extension, use `dist/sc.zip`.

OpenAI Skills follow the Agent Skills standard. ChatGPT can automatically use an installed relevant skill; OpenAI Academy also documents explicit skill selection by **@-mention**. Do not promise `/sc` on ChatGPT Web unless that surface explicitly adds slash invocation. For a personal Skill upload, prefer `@sc`; for the workspace plugin, use `@SI-Coder` / the plugin picker when explicit invocation is needed.

### Other Agent Skills clients

Use the canonical source in `skills/sc/SKILL.md` or the `.skill` package if the client supports packaged Agent Skills.

## Security

Never copy provider secrets out of their secure stores just to complete installation. Installing SI-Coder installs workflow instructions and local tooling only; provider authorization remains a separate secure connection step.
