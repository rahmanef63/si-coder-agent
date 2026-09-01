# SI-Coder installation and onboarding

Choose the guide that matches the surface where SI-Coder will run. The Agent Skills standard defines a **skill directory containing `SKILL.md`**. Archive extensions such as `.zip` or `.skill` are transport/package formats used by particular clients; they are not the canonical skill source. See the [Agent Skills specification](https://agentskills.io/specification).

## Format matrix

<!-- INSTALL_MATRIX_SSOT:BEGIN -->
| Surface | What it installs/reads | Recommended SI-Coder link | Invocation |
|---|---|---|---|
| Claude Code | Plugin marketplace, or a skill **directory containing `SKILL.md`** | [GitHub repo](https://github.com/rahmanef63/si-coder-agent) / [sc skill directory](https://github.com/rahmanef63/si-coder-agent/tree/v0.8.7/skills/sc) | `/sc` |
| Claude Web / claude.ai | **ZIP containing the skill folder** | [Download `sc.zip`](https://github.com/rahmanef63/si-coder-agent/releases/download/v0.8.7/sc.zip) | Automatic when relevant |
| Codex CLI / app | GitHub skill **directory containing `SKILL.md`** | [sc skill directory](https://github.com/rahmanef63/si-coder-agent/tree/v0.8.7/skills/sc) plus core sibling skills | Client-specific / automatic |
| ChatGPT personal Skills | Uploaded skill package; canonical content is a folder with `SKILL.md` | [Download `sc.zip`](https://github.com/rahmanef63/si-coder-agent/releases/download/v0.8.7/sc.zip) | Automatic or `@sc` |
| ChatGPT managed workspace | GitHub plugin marketplace | [GitHub repo](https://github.com/rahmanef63/si-coder-agent) | `@SI-Coder` / plugin picker / automatic |
| Hermes / OpenClaw / generic Agent Skills | Skill **directory containing `SKILL.md`** | [sc skill directory](https://github.com/rahmanef63/si-coder-agent/tree/v0.8.7/skills/sc) or `install.sh` | Runtime-specific |
| Client that explicitly supports `.skill` archives | `.skill` archive containing a normal skill directory | [Download optional `sc.skill`](https://github.com/rahmanef63/si-coder-agent/releases/download/v0.8.7/sc.skill) | Client-specific |
<!-- INSTALL_MATRIX_SSOT:END -->

### Important distinction

- **Canonical format:** `skills/sc/SKILL.md` plus optional sibling `scripts/`, `references/`, `assets/`, and `agents/` files.
- **ZIP upload:** use `sc.zip` where the product asks for a ZIP. Anthropic explicitly documents ZIP upload for Claude Web.
- **`.skill` archive:** SI-Coder still publishes `sc.skill` as a ZIP-format distribution artifact for clients that explicitly accept that extension. None of the Claude/OpenAI surfaces verified for this release requires the `.skill` extension itself.
- **`sc.zip` does not contain `sc.skill`:** they are sibling release assets with identical bytes. If you unzip `sc.zip`, you should see `sc/` and its `SKILL.md`/resources, not another nested `.skill` file.
- **Do not install only the raw `SKILL.md`** when the skill needs bundled resources. The directory is the unit of installation. The raw file link is primarily for inspection.

## Direct source links

- [Canonical `sc` skill directory](https://github.com/rahmanef63/si-coder-agent/tree/v0.8.7/skills/sc)
- [View raw `SKILL.md`](https://raw.githubusercontent.com/rahmanef63/si-coder-agent/v0.8.7/skills/sc/SKILL.md)
- [Download upload-ready `sc.zip`](https://github.com/rahmanef63/si-coder-agent/releases/download/v0.8.7/sc.zip)
- [Download optional `sc.skill`](https://github.com/rahmanef63/si-coder-agent/releases/download/v0.8.7/sc.skill)

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
