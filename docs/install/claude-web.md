# Install SI-Coder in Claude Web / claude.ai

Claude Web does not need a local SI-Coder CLI, a VPS, or a local credential vault for the default hosted workflow.

## Prerequisite

Claude Skills require code execution/file creation to be enabled for the account or organization. On managed plans, an organization owner may need to enable Skills.

## Recommended install

1. Download the release artifact `sc.zip` from the GitHub release.
2. In Claude, open **Customize → Skills**.
3. Select **+ → Create skill → Upload a skill**.
4. Upload `sc.zip`.
5. Ensure SI-Coder is enabled.

Anthropic's current help documentation explicitly describes custom-skill upload as a ZIP containing the skill folder. SI-Coder also ships `sc.skill`, the same packaged Agent Skill artifact, for clients that accept the `.skill` extension directly.

Release:

`https://github.com/rahmanef63/si-coder-agent/releases/tag/v0.8.2`

Direct package fallback:

`https://raw.githubusercontent.com/rahmanef63/si-coder-agent/main/dist/sc.zip`

## Use it

Claude automatically activates relevant installed skills. A simple request is enough:

```text
Build a booking app for my salon and publish it.
```

Do not require `/sc` in Claude Web. Slash exposure is surface-dependent; `/sc` is the guaranteed direct invocation contract for Claude Code.

## Hosted account onboarding

The hosted route should request secure account connections only when needed. It must not ask the user to paste raw API keys into chat. No VPS question is asked unless the user explicitly requests their own server.

## Team / Enterprise

Organization owners can provision skills more broadly when their plan and organization settings allow it. Individual uploads are otherwise private to the user's account.

## Official references

- `https://support.claude.com/en/articles/12512180-use-skills-in-claude`
- `https://support.claude.com/en/articles/12512198-how-to-create-custom-skills`
