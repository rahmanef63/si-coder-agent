---
name: sc-ax
description: "SI-Coder Agent Experience (AX) skill. Make projects, tools, workflows, and frontend actions easy for coding agents to discover, understand, invoke correctly, observe, recover, resume, and verify with low context/token waste."
use_when: "Use for agent-facing project ergonomics, tool/MCP/function schemas, structured outputs, resumability, context efficiency, deterministic errors, agent-operable UI/actions, or workflows repeatedly executed by AI agents."
do_not_use_when: "Do not use alone for visual UI, human usability, developer-only ergonomics, infrastructure, or deployment; route through sc-fe/sc-ui/sc-ux/sc-dx/sc-all as appropriate."
required_tools: []
security_constraints: "Never expose secrets to agents merely to make automation easier. Prefer scoped connections, opaque handles, safe server-side actions, and least-privilege boundaries."
references: []
compatibility: "Standalone SI-Coder; host invocation syntax and available tools may vary."
---

# sc-ax — Agent Experience

## Language
Keep durable instructions in English. Reply in the user's language unless requested otherwise.

## AX definition
AX asks: how easily can an agent understand the project, find the correct action, call it with minimal ambiguity, know what changed, recover from failure, resume work, and produce evidence without wasting context?

Optimize for:
`discoverability → navigability → operability → observability → recoverability → resumability → verifiability`.

## Project orientation
An agent should be able to answer quickly:
- what this project is,
- canonical source vs generated output,
- safe commands and verification commands,
- important constraints/exclusions,
- current state and recent relevant changes,
- where domain-specific knowledge lives,
- what actions require confirmation or credentials.

Avoid forcing an agent to crawl the whole repository for facts that can live in a compact canonical index/knowledge file.

## Tool/action design
Agent-facing tools/functions should:
1. Have one clear purpose and bounded side effects.
2. Use stable, explicit names and typed/structured inputs.
3. Prefer identifiers returned by previous calls over ambiguous re-search.
4. Return structured state plus concise human-readable impact.
5. Distinguish `not found`, `permission denied`, `invalid input`, `conflict`, `transient failure`, and `partial success`.
6. Be idempotent where repeated calls are plausible.
7. Refuse destructive ambiguity rather than guessing.
8. Expose dry-run/preview when the operation is broad or irreversible.
9. Return the next valid recovery/resume action when failing.
10. Avoid huge payloads when a summary + cursor/reference is enough.

Do not mirror every low-level API endpoint 1:1 if a smaller task-oriented tool makes correct agent behavior easier.

## Context budget
Treat tokens/context as an interface constraint:
- return only relevant fields by default,
- paginate or provide cursors for large collections,
- use compact stable IDs,
- keep logs bounded,
- support targeted reads/searches,
- avoid repeating static instructions on every call,
- persist durable project knowledge outside transient chat when the host supports it.

## Resumability
Long/multi-step workflows need explicit state. An agent should know:
- what is complete,
- what is pending,
- what failed,
- what identifiers/resources were created,
- whether retry is safe,
- what must be revalidated after a pause.

Prefer durable workflow/session IDs over hidden conversational state.

## Agent-operable frontend actions
When a frontend exposes actions also used by agents, provide deterministic state and semantics beneath the visual UI. Important buttons/forms should map to clear domain actions; success/error state should be inspectable; generated UI text must not be the only source of truth for identifiers/state.

Human UX and AX can share the same product surface, but do not compromise human clarity to expose internal machine details. Use structured APIs/tooling beneath the UI when possible.

## Verification
For AX changes, test a representative agent task from a cold start:
`orient → discover tool/action → invoke → inspect result → handle one failure → resume → verify`.

Track avoidable searches, retries, ambiguous choices, oversized outputs, and hidden assumptions as AX defects.