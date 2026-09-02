# Install SI-Coder in Codex

Codex installs Agent Skills as **directories containing `SKILL.md`**. Its official skill installer accepts GitHub repository paths and verifies that the selected directory contains `SKILL.md`. Do not install the `.skill` release archive into Codex as the default path.

## Ask Codex to install it

```text
Install SI-Coder from https://github.com/rahmanef63/si-coder-agent
Read AI_INSTALL.md and use the built-in skill installer for the core SI-Coder skills.
```

Core GitHub directories:

- [skills/sc](https://github.com/rahmanef63/si-coder-agent/tree/v0.9.1/skills/sc)
- [skills/sc-build](https://github.com/rahmanef63/si-coder-agent/tree/v0.9.1/skills/sc-build)
- [skills/sc-all](https://github.com/rahmanef63/si-coder-agent/tree/v0.9.1/skills/sc-all)
- [skills/sc-provider](https://github.com/rahmanef63/si-coder-agent/tree/v0.9.1/skills/sc-provider)
- [skills/sc-install](https://github.com/rahmanef63/si-coder-agent/tree/v0.9.1/skills/sc-install)

The main raw entry point is [skills/sc/SKILL.md](https://raw.githubusercontent.com/rahmanef63/si-coder-agent/v0.9.1/skills/sc/SKILL.md), but install the directory rather than copying only that file because SI-Coder can use bundled metadata/resources.

## Local script fallback

From a repository checkout:

```bash
bash install.sh --agent codex
```

To register the bundled SI-Coder MCP as well:

```bash
bash install.sh --agent codex --with-mcp
```

## Use it

Use the current Codex skill-selection/invocation UX. Natural-language requests may activate `sc`; do not assume Claude's `/sc` syntax.

## Official references

- https://github.com/openai/skills
- https://github.com/openai/skills/blob/main/skills/.system/skill-installer/SKILL.md
- https://agentskills.io/specification
