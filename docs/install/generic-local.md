# Install SI-Coder in a generic local Agent Skills runtime

The Agent Skills standard defines a skill as a **directory containing `SKILL.md`**. For local clients, this is the preferred source format.

## Canonical source

- [skills/sc directory](https://github.com/rahmanef63/si-coder-agent/tree/v0.8.5/skills/sc)
- [raw `SKILL.md`](https://raw.githubusercontent.com/rahmanef63/si-coder-agent/v0.8.5/skills/sc/SKILL.md)

Use the whole directory when resources are present; do not copy only `SKILL.md` unless the client or skill is intentionally single-file.

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

## Archive-only clients

Only when a client explicitly asks for an archive/package:

- [ZIP package](https://github.com/rahmanef63/si-coder-agent/releases/download/v0.8.5/sc.zip)
- [optional `.skill` archive](https://github.com/rahmanef63/si-coder-agent/releases/download/v0.8.5/sc.skill)

The `.skill` extension is not part of the core Agent Skills directory specification; it is an optional distribution convention.

## Invocation

Invocation syntax is runtime-specific. The skill identity is `sc`; do not assume every product uses Claude's `/sc` syntax.
