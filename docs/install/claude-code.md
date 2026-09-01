# Install SI-Coder in Claude Code

Use the repository as a Claude Code plugin marketplace. This is the preferred local Claude installation because it installs the skill set and keeps the bundled MCP configuration available.

## Fast path

In Claude Code, run:

```text
/plugin marketplace add rahmanef63/si-coder-agent
/plugin install si-coder@si-coder-marketplace
```

Then start with:

```text
/sc Build a booking app for my salon.
```

## Skill-only source format

Claude Code skills use a directory containing `SKILL.md`. The full plugin marketplace route above is preferred for SI-Coder, but the canonical main skill source is:

- [skills/sc directory](https://github.com/rahmanef63/si-coder-agent/tree/v0.8.14/skills/sc)
- [raw skills/sc/SKILL.md](https://raw.githubusercontent.com/rahmanef63/si-coder-agent/v0.8.14/skills/sc/SKILL.md)

Do not use `sc.zip` or `sc.skill` for the normal Claude Code plugin installation. Those are archive artifacts for upload/package workflows.

## If an AI agent is doing the install

Give it this instruction:

```text
Install SI-Coder from https://github.com/rahmanef63/si-coder-agent
Follow AI_INSTALL.md. Use the Claude Code marketplace/plugin route.
```

The agent should not ask you to clone the repository manually unless marketplace installation is unavailable.

## Development checkout

For plugin development or local testing:

```bash
git clone https://github.com/rahmanef63/si-coder-agent.git
cd si-coder-agent
claude --plugin-dir "$PWD"
```

## First run

`/sc` is the normal entry point. For a new app, describe the product outcome. For an existing app, ask SI-Coder to publish or improve it.

Local Claude Code can use your own server or the easiest managed route. If that cannot be inferred from existing configuration, SI-Coder asks one plain-language choice rather than asking you to choose Dokploy, Vercel, Convex, or DNS settings.

## Account access

When provider access is required locally, SI-Coder first chooses/creates a labeled connection and shows the official auth/credential page. OAuth stays in the external connected-account flow; direct keys use `sc user credential-set ... --connection <alias>` with hidden input. Do not paste raw provider keys into chat.

Verify local provider access with:

```bash
sc doctor
```

## Update

Marketplace/plugin updates should be handled through Claude Code's plugin workflow. For a source checkout, SI-Coder also provides:

```bash
sc update --check
sc update
```

## Official reference

Anthropic's Claude Skills documentation explains how Claude loads relevant skills automatically and how custom skills are structured. The repository's `.claude-plugin/marketplace.json` is validated by the installed Claude CLI before release.
