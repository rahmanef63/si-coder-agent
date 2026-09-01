# Install SI-Coder in Codex

SI-Coder follows the Agent Skills layout used by Codex. The most portable GitHub-first route is to let Codex's skill installer install the core skill directories from this repository.

## Ask Codex to install it

```text
Install SI-Coder from https://github.com/rahmanef63/si-coder-agent
Read AI_INSTALL.md and use the built-in skill installer for the core SI-Coder skills.
```

Core paths:

```text
skills/sc
skills/sc-build
skills/sc-all
skills/sc-provider
skills/sc-install
```

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

Codex skill selection is not Claude slash syntax. When the current Codex client exposes explicit skill selection, use its skill syntax, for example:

```text
$sc Build a booking app for my salon.
```

Natural-language invocation may also activate a relevant skill depending on the client.

## First run

Local Codex follows the local runtime policy: inspect the project and existing configuration first, then use an existing server if appropriate or choose the easiest managed route. The user should not have to choose a framework, database, hosting vendor, or DNS record type.

## Account onboarding

Use local secure credential handoffs only when necessary:

```bash
sc setup
sc doctor
```

Never put raw provider secrets into the prompt or a tool JSON payload.
