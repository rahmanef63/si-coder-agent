# Install SI-Coder in a generic local Agent Skills runtime

Use the repository's canonical `skills/` tree when the client supports Agent Skills-style directories.

## Supported installer targets

```bash
bash install.sh --agent claude
bash install.sh --agent codex
bash install.sh --agent hermes
bash install.sh --agent openclaw
bash install.sh --agent all
```

For another runtime:

```bash
bash install.sh --skills-dir /path/to/runtime/skills
```

The installer links each `skills/*/SKILL.md` directory into the selected user skills location. It does not copy provider credentials.

## Packaged-skill clients

If the client accepts a packaged skill instead of a directory, use the release artifact:

`dist/sc.skill`

or the compatibility ZIP:

`dist/sc.zip`

## Invocation

Invocation syntax is runtime-specific. The skill identity is `sc`; do not assume every product uses Claude's `/sc` syntax.

## First run

For local runtimes:

```bash
sc setup
sc doctor
```

Then describe the product goal in the agent. SI-Coder should ask product questions only when needed and keep infrastructure decisions internal by default.
