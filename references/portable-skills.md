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
| ChatGPT uploaded Skills (eligible workspaces) | uploaded complete skill package; SI-Coder recommends ZIP because OpenAI does not document `.skill` as required; uploaded Skills currently depend on eligible workspace/plan settings |
| ChatGPT workspace | GitHub plugin marketplace |
| Generic local Agent Skills | skill directory containing `SKILL.md` |
| Explicit `.skill`-aware clients | optional `.skill` ZIP-format archive |

## Current release links — v0.9.2

- Source directory: `https://github.com/rahmanef63/si-coder-agent/tree/v0.9.2/skills/sc`
- Raw entry point: `https://raw.githubusercontent.com/rahmanef63/si-coder-agent/v0.9.2/skills/sc/SKILL.md`
- ZIP upload package: `https://github.com/rahmanef63/si-coder-agent/releases/download/v0.9.2/sc.zip`
- Optional `.skill` archive: `https://github.com/rahmanef63/si-coder-agent/releases/download/v0.9.2/sc.skill`

## Rule for agents

Never infer that a product accepts `.skill` just because the file is a ZIP archive. Follow the product's documented import contract. Likewise, do not give a raw `SKILL.md` file as the install unit when the skill depends on bundled resources.

## Local runtime contract

The current SI-Coder local CLI/installer requires **Node.js 22+**. Full local installs read `skills/catalog.json` and expose active/default skills only. Stub and legacy skills remain in source for maintenance/backward compatibility and are not normal user-facing capabilities. Credential-dependent direct local helpers should run through `sc run -- ...` so selected named connections are injected only into the child process.

## Distribution availability

Treat a pushed tag, a GitHub Release, and an npm publication as separate states. Before presenting a public download as usable, verify the destination without maintainer authentication. The v0.9.2 release workflow fails closed if GitHub/raw tagged source is not publicly reachable and can be rerun for the same existing tag after visibility is restored.
