# Standalone agent workflow, memory, evidence, recipes, and skill verification

SI-Coder keeps its agent workflow inside the repository. No external orchestrator, sibling project, hosted memory database, or vendor-specific runtime is required for the core loop.

```text
install
→ configure
→ prepare task
→ execute
→ verify
→ update memory/evidence
```

External providers and MCP clients are optional consumers/integrations. The canonical machine-function schema lives in `machine/functions.json` and the bundled `scripts/sc-mcp.js` exposes that schema over standard MCP stdio.

## Action/service boundary

New agent-workflow code is a vertical slice under `lib/agent/`:

```text
lib/agent/
├── actions.js          # why / when / policy / orchestration
├── policy.js           # LOW / MEDIUM / HIGH classifier
├── memory-store.js     # repo-local canonical memory mechanics
├── evidence-store.js   # structured evidence receipts
├── recipe-store.js     # repeated-work lifecycle
├── skill-verifier.js   # skill quality checks
├── repo-service.js     # filesystem/git/test mechanics
├── security.js         # secret-shaped content rejection
└── markdown-record.js  # portable frontmatter records
```

`actions.js` owns orchestration and policy. Services receive explicit inputs and return structured outputs. They do not depend on hidden global orchestrator state.

## Risk-based isolation

Use:

```bash
sc risk "change provider auth routing"
sc task prepare "change provider auth routing" --json
```

Policy:

- **LOW** — docs, typo, isolated formatting/small bug/test. Direct `main` is allowed after targeted verification.
- **MEDIUM** — contained CLI/provider UX/skill behavior. Prefer a short-lived branch/worktree when useful.
- **HIGH** — credentials, auth, migrations, provider abstraction, machine/MCP schema, destructive paths, installer/distribution, security-sensitive code, broad shared refactors. Isolation is required.

`sc task prepare` intentionally does **not** load project memory for LOW-risk work. For MEDIUM/HIGH work it retrieves only ranked relevant records and applicable recipes, keeping context compact.

## Repo-local memory

Canonical files are human-readable Markdown with JSON-compatible frontmatter:

```text
.agent/
├── memory/
│   ├── tasks/
│   ├── debug/
│   ├── tests/
│   ├── decisions/
│   └── failures/
├── recipes/
├── scripts/
└── evidence/
```

Initialize explicitly when needed:

```bash
sc memory init
```

Record types:

```bash
sc memory record task --title "Connection cleanup" --status active
sc memory record debug --title "GitHub source routing" \
  --issue "wrong source selected" \
  --symptoms "external selected|direct token inherited" \
  --root-cause "..." \
  --failed-attempts "..." \
  --fix "..." \
  --verification "regression passed|environment assertion passed"
sc memory record test --title "GitHub auth regression" \
  --target "GitHub connection" \
  --source "manual CLI" \
  --environment "local" \
  --steps "select direct|run verify" \
  --expected "direct source stays selected" \
  --actual "direct source stayed selected" \
  --result pass
```

For longer notes use `--body-file PATH`. `--body` is intentionally refused on the CLI so long-form/debug content does not get copied into shell history accidentally.

### Lifecycle and freshness

Memory state is one of:

```text
active → confirmed → superseded / archived
```

Records can also carry confidence, scope, tags, commit, `last_verified`, and `supersedes`.

Query only what the current task needs:

```bash
sc memory query "github auth" --tags github,auth --limit 5 --json
```

Retrieval ranks title/content/tags/scope, down-ranks superseded/archived records, and marks old records `stale`. The default stale window is 90 days and can be changed with `--stale-after-days`; `--fresh-only` excludes stale records.

This prevents an old provider behavior report from silently becoming a current fact.

## Test memory

A test record requires:

- target;
- source;
- environment;
- steps;
- expected;
- actual;
- result.

It also records commit, related areas, and `last_verified` when available.

`sc verify` automatically writes a compact Test Memory and Evidence Receipt by default. Raw test output is returned only as bounded status/tails and is not persisted in memory.

## Evidence receipts

Evidence is structured JSON under `.agent/evidence/` and can contain:

- target and commit;
- risk;
- command and redacted arguments;
- exit code;
- stdout/stderr contracts;
- filesystem and metadata assertions;
- permissions assertions;
- provider/source/migration assertions;
- named quality-gate results.

Never put raw credentials in a receipt. Both memory and evidence writes run through the same secret-shaped content rejection layer before touching disk.

## Recipe → executable script

Repeated deterministic workflows progress through:

```text
observed
→ repeated
→ candidate
→ verified
→ executable
```

Example:

```bash
sc recipe observe release-candidate-check --steps "syntax|tests|docs|skills|repository-wide secret scan"
sc recipe list
sc recipe verify release-candidate-check --yes
sc recipe promote release-candidate-check --script scripts/release-candidate-check.js --yes
```

Promotion requires an already verified recipe and an existing repository-local script. Paths that escape the repository, including escaping symlinks, are rejected.

A successful recorded `sc verify` observes the `release-candidate-check` sequence so repeated verification can become a reusable recipe instead of being reasoned from scratch every session. Read-only verification (`--no-record` / `npm run verify:release`) never changes recipe state.

The deterministic release helper is:

```bash
npm run verify:release
```

It returns structured JSON with syntax/tests/docs/distribution/skills/repository-wide secret-scan results. Add `-- --record` only when a persistent verification receipt/test-memory update is desired.

## Skill verification

Every canonical `SKILL.md` uses the existing frontmatter format extended with backward-compatible quality fields:

```yaml
name: ...
description: ...
use_when: ...
do_not_use_when: ...
required_tools: []
security_constraints: ...
references: []
compatibility: ...
```

Verify:

```bash
sc skill verify
sc skill verify --strict --json
```

Checks include:

- required metadata;
- explicit trigger contract;
- missing local references;
- declared unsupported tools when a supported-tool set is supplied;
- secret-shaped content;
- duplicated long prose instructions while ignoring fenced code examples;
- compatibility metadata.

Generated distribution artifacts remain controlled by the existing deterministic packaging tests.

## Security invariants

Memory, evidence, recipes, scripts, logs, and machine payloads must not become credential transport/storage.

The write guard rejects common private-key/token shapes and non-empty secret-shaped fields such as token/password/API-key/credential values. The existing machine adapter also recursively rejects secret-shaped JSON input fields before dispatch.

Provider credentials continue to use SI-Coder's protected user/connection credential path; externally managed OAuth/MCP credentials remain with their provider/backend.

## Verification workflow

For a high-risk SI-Coder change:

```text
sc task prepare <intent>
→ isolate branch/worktree
→ targeted tests
→ implementation
→ targeted tests again
→ sc skill verify --strict
→ sc verify
→ inspect evidence/test memory
→ git diff review
→ merge/release only when clean
```

`sc verify` currently gates:

- syntax of the agent workflow integration;
- full repository regression suite;
- documentation synchronization checks;
- lifecycle/catalog consistency for installed capabilities;
- strict-compatible skill quality;
- repository-wide secret scan of checkout text files that could enter source/generated packages; `.agent` write-time secret rejection remains a separate guard.

The full repository test suite continues to cover CLI, provider behavior, machine/MCP schemas, distribution, migration/security contracts, and other existing surfaces.

## Machine/MCP functions

Agent workflow functions are available through `machine/functions.json` and standard MCP:

```text
sc.task.risk
sc.task.prepare
sc.memory.query
sc.memory.record
sc.memory.status
sc.evidence.record
sc.recipe.list
sc.recipe.observe
sc.recipe.verify
sc.recipe.promote
sc.skill.verify
sc.verify
```

Machine writes use bounded JSON schemas with `additionalProperties: false` where appropriate. Destructive/lifecycle promotions require explicit confirmation. Plaintext credential fields are not part of the machine contract.
