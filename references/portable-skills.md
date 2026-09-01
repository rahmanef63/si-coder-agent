# Portable SI-Coder distribution

SI-Coder separates the **canonical Agent Skills format** from client-specific transport packages.

## Canonical Agent Skills format

The standard unit is a directory containing `SKILL.md`:

```text
sc/
├── SKILL.md
├── agents/       # optional
├── scripts/      # optional
├── references/   # optional
└── assets/       # optional
```

Canonical source: `skills/sc/`. The Agent Skills specification does not define `.skill` as the core source format.

## Surface matrix

| Surface | Correct install transport |
|---|---|
| Claude Code | plugin marketplace or GitHub/disk skill directory containing `SKILL.md` |
| Claude Web | ZIP containing the skill folder |
| Codex | GitHub/disk skill directory containing `SKILL.md` |
| ChatGPT personal Skills | uploaded complete skill package; SI-Coder recommends ZIP because OpenAI does not document `.skill` as required |
| ChatGPT workspace | GitHub plugin marketplace |
| Generic local Agent Skills | skill directory containing `SKILL.md` |
| Explicit `.skill`-aware clients | optional `.skill` ZIP-format archive |

## Stable links for v0.8.11

- Source directory: `https://github.com/rahmanef63/si-coder-agent/tree/v0.8.11/skills/sc`
- Raw entry point: `https://raw.githubusercontent.com/rahmanef63/si-coder-agent/v0.8.11/skills/sc/SKILL.md`
- ZIP upload package: `https://github.com/rahmanef63/si-coder-agent/releases/download/v0.8.11/sc.zip`
- Optional `.skill` archive: `https://github.com/rahmanef63/si-coder-agent/releases/download/v0.8.11/sc.skill`

## Rule for agents

Never infer that a product accepts `.skill` just because the file is a ZIP archive. Follow the product's documented import contract. Likewise, do not give a raw `SKILL.md` file as the install unit when the skill depends on bundled resources.
