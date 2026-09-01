# SI-Coder installation and onboarding

Choose the guide that matches the surface where SI-Coder will run. Do not make a non-technical user choose infrastructure before installation.

| Surface | Recommended install | Explicit invocation | Local machine required? |
|---|---|---|---|
| Claude Code | GitHub marketplace/plugin | `/sc` | Yes |
| Claude Web / claude.ai | Upload `sc.zip` / packaged skill | Automatic when relevant | No |
| Codex CLI / app | GitHub skill installer or `install.sh` | `$sc` when supported | Usually yes |
| ChatGPT personal Skills | Upload packaged skill | Automatic when relevant | No |
| ChatGPT managed workspace | Import GitHub plugin marketplace | `@SI-Coder` / `+ → More` or automatic selection | No |
| Hermes / OpenClaw / generic Agent Skills | `install.sh` or skill directory | Runtime-specific | Yes |

## Guides

- [Claude Code](claude-code.md)
- [Claude Web / claude.ai](claude-web.md)
- [Codex](codex.md)
- [ChatGPT personal Skills](chatgpt-personal-skills.md)
- [ChatGPT workspace marketplace](chatgpt-workspace-marketplace.md)
- [Generic local Agent Skills runtimes](generic-local.md)
- [First-run account and credential onboarding](first-run-onboarding.md)

## One instruction for an AI agent

If a user only gives the repository URL and says “install this,” read the root [`AI_INSTALL.md`](../../AI_INSTALL.md), detect the current surface, and follow the matching guide. Do not ask the user which installation system they are using when the current runtime can determine it itself.

## Stable artifacts

GitHub repository:

`https://github.com/rahmanef63/si-coder-agent`

Release page:

`https://github.com/rahmanef63/si-coder-agent/releases/tag/v0.8.2`

The release contains:

- `sc.skill` — packaged Agent Skill artifact.
- `sc.zip` — byte-identical ZIP-extension copy for uploaders that require `.zip`.
- `sc-build.skill` — focused build-flow package.
- `manifest.json` — artifact fingerprints.

`skills/*/SKILL.md` remains the editable source of truth. Generated `.skill` packages are release/install artifacts.
