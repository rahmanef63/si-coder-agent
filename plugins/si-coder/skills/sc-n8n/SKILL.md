---
name: sc-n8n
description: "Drive a user-configured self-hosted or cloud n8n instance through the official @n8n/cli. List, inspect, create, update, activate, and verify workflows; inspect executions; manage projects, tags, variables, data tables, and packages without assuming a specific server, deployment platform, or account."
use_when: "Use for n8n workflow, execution, project, variable, data-table, package, CLI connection, or self-hosted n8n administration tasks."
do_not_use_when: "Do not use when the task is outside n8n or when SI-Coder does not have an explicitly configured n8n endpoint/account for the requested operation."
required_tools: ["n8n-cli"]
security_constraints: "Never request, print, or persist an n8n API key in chat/tool payloads. Resolve access from SI-Coder's selected user/connection or another explicitly secure local credential channel."
references: []
compatibility: "Standalone SI-Coder; supports any n8n instance compatible with the configured CLI/public API."
---

# sc-n8n — n8n control via @n8n/cli

Use the official `@n8n/cli` binary (`n8n-cli`) against the **user-selected n8n instance**. Do not assume a fixed hostname, backup location, deployment platform, shell profile, project, or workflow set.

## Required connection state

| Setting | Purpose |
|---|---|
| `N8N_URL` | Base URL of the selected n8n instance, for example `https://n8n.example.com` |
| `N8N_API_KEY` | Public API key for that instance; keep it in the selected SI-Coder credential store or another secure local source |
| `~/.n8n-cli/config.json` | Optional CLI-local configuration; never treat it as the only possible source of truth |

Install the binary only when needed:

```bash
npm i -g @n8n/cli
# or use: npx @n8n/cli ...
```

## Auth resolution

When diagnosing which account/instance is active, inspect explicit CLI flags first, then environment variables, then CLI config. Environment variables can override a value saved in the CLI config, so a newly written config value may appear ignored when an older environment variable is still present.

If the API returns `401` or an invalid-signature error, do not guess that the header format is wrong. Verify the selected instance/account, then create or rotate an API key from the official n8n UI and store it through the safe SI-Coder credential handoff. Never print the key during verification.

## Connect / verify

```bash
n8n-cli config show
n8n-cli workflow list --format=id-only
```

A successful read-only workflow listing is the preferred smoke check before mutations.

## Command surface

Every command supports `--help`. Common output formats are `table`, `json`, and `id-only` when supported by the installed CLI version.

| Topic | Typical commands |
|---|---|
| `workflow` | list · get · create · update · delete · activate · deactivate · tags · transfer |
| `execution` | list · get · retry · stop · delete |
| `credential` | list · get · schema · create · delete · transfer |
| `project` | list · get · create · update · delete · members |
| `tag` | list · create · update · delete |
| `variable` | list · create · update · delete |
| `data-table` | list · get · create · delete · rows operations |
| `user` | list · get |
| `config` | set-url · set-api-key · show |
| `source-control` | pull |
| `package` | export · import when supported by the installed CLI |
| `audit` / auth | inspect with `--help` because availability can vary by CLI version |

## Safe recipes

```bash
# inspect before changing
n8n-cli workflow list
n8n-cli workflow get <id> --format=json

# recent failures
n8n-cli execution list --status=error --limit=10

# create from reviewed JSON
cat workflow.json | n8n-cli workflow create --stdin

# inspect a credential schema before creating metadata
n8n-cli credential schema <credentialType>

# portable workflow package when supported
n8n-cli package export --workflow-id=<id> --output=export.n8np
```

## Backup / restore policy

Do not assume backups live in a particular directory or that n8n is deployed with a particular provider. Before a destructive or broad workflow change:

1. identify the selected n8n instance;
2. inspect the affected workflow/project IDs;
3. export the relevant workflow/package when the CLI supports it, or use the deployment provider's existing backup mechanism;
4. record an Evidence Receipt for high-risk changes;
5. verify the workflow after the mutation.

## Rules

1. Read before write; use dry-run functionality when the installed subcommand provides it.
2. Require explicit confirmation for delete, bulk deactivate, transfer, or other destructive/broad operations.
3. Never bulk-edit workflows based on names alone when IDs can disambiguate them.
4. Never assume production webhooks, workflows, projects, credentials, URLs, or backup paths from repository documentation.
5. Treat CLI capabilities as version-dependent; check `n8n-cli <command> --help` when behavior matters.
6. Keep credentials outside memory, evidence, recipes, logs, and tool payloads.

## Linked SI-Coder skills

- `sc-dokploy` may be used when the **user-selected** n8n deployment actually runs on Dokploy.
- `sc-git` may help when a workflow is intentionally replaced by a repository-native automation.

These are optional internal SI-Coder capabilities, not external project dependencies.
