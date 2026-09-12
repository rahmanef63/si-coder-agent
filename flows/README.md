# SI-Coder flows (MVP)

Declarative DAGs that collapse multi-step `sc` / provider MCP work into one run.

## CLI

```bash
export PATH="/home/rahman/.local/bin:$PATH"
sc flow list
sc flow show provider-health
sc flow validate provider-health
sc flow run provider-health --dry-run --json
sc flow run provider-health --props '{"providers":["github"]}' --json
```

## Discovery

1. Packaged `flows/*.json` in this repository
2. Optional project overlay `.si-coder/flows/*.json`
3. Absolute/relative path to a flow JSON file

## Step kinds (`uses`)

- `sc.fn` — `node scripts/sc-agent.js <name>` with JSON stdin (`with.name`, `with.input`)
- `sc.cli` — `node bin/sc-entry.js` + argv array only (no shell)
- `provider.mcp` — `doku` or `hostinger` mail helpers; requires `confirm=true`
- `flow` — recursive subflow (`with.flow`, `with.props`); max depth 5

## Templates

- `{{props.path}}`
- `{{steps.<id>.output.path}}` / `{{steps.<id>.ok}}`
- Optional: `{{props.x?}}`
- Whole-string tokens preserve non-string JSON values (arrays/objects)

## Agents

Machine tools: `sc.flow.list`, `sc.flow.show`, `sc.flow.validate`, `sc.flow.run`.
