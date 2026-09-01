# Install SI-Coder in Claude Web / claude.ai

Claude Web does not need a local SI-Coder CLI, a VPS, or a local credential vault for the default hosted workflow.

## Correct package format

Anthropic currently documents custom-skill upload as a **ZIP file containing the skill folder**. Use `sc.zip` here, not the `.skill` filename.

[Download SI-Coder for Claude Web v0.8.13 (`sc.zip`)](https://github.com/rahmanef63/si-coder-agent/releases/download/v0.8.13/sc.zip)

The ZIP contains the canonical `sc/SKILL.md` entry point plus its bundled resources.

## Install

1. Download [`sc.zip`](https://github.com/rahmanef63/si-coder-agent/releases/download/v0.8.13/sc.zip).
2. In Claude, open **Customize → Skills**.
3. Select **+ → Create skill → Upload a skill**.
4. Upload `sc.zip`.
5. Ensure the skill is enabled.

Do not use the raw `SKILL.md` as the upload when the packaged skill includes supporting files. Claude's documented web flow expects the complete skill folder inside a ZIP.

> **Archive note:** `sc.zip` does not contain a nested `sc.skill`. `sc.zip` and `sc.skill` are separate, byte-identical release assets. When you open the ZIP, the expected content is the `sc/` skill directory with `SKILL.md` and its resources.

## Use it

Claude automatically activates relevant installed skills. A simple request is enough:

```text
Build a booking app for my salon and publish it.
```

Do not require `/sc` in Claude Web. Slash exposure is surface-dependent; `/sc` is the Claude Code invocation for this skill.

## Hosted account onboarding

The hosted route should request secure account connections only when needed. It must not ask the user to paste raw API keys into chat. No VPS question is asked unless the user explicitly requests their own server.

## Team / Enterprise

Organization owners can provision skills more broadly when their plan and organization settings allow it. Individual uploads are otherwise private to the user's account.

## Official reference

- https://support.claude.com/en/articles/12512180-use-skills-in-claude
