# si-coder output styles (token-savers)

Owner-selectable output styles for the si-coder agent — they trim how much the agent
*says*, never what a skill *does*. Deploy behaviour, idempotency, and the "secrets via
env only" rules are untouched.

Ported from the **MSO** project (`rahmanef63/mso`, `OsConfig.tokenSaver` in
`app/api/assistant/route.ts`), which appends the same instructions to its assistant's
system prompt. Here the selector is an environment variable the agent reads.

## Selecting a style

```bash
export SC_OUTPUT_STYLE=caveman     # or: ponytail, or: off (default)
```

| Value | Effect |
|---|---|
| `off` (default) | No output-style instruction added — normal phrasing. |
| `caveman` | Terse: drop articles/filler/pleasantries, fragments OK. Keeps **all** technical substance and exact code/errors verbatim. |
| `ponytail` | Lazy senior dev: the shortest solution that works, no unrequested abstractions or boilerplate. Code first, then ≤3 short lines of explanation. |

An unknown or empty value resolves to `off` (fail-safe — a typo never injects a garbage instruction).

## How the agent applies it

The umbrella `SKILL.md` instructs the agent: when `SC_OUTPUT_STYLE` is `caveman` or
`ponytail`, adopt that style for all `sc-*` output. To read the active instruction
programmatically:

```bash
node scripts/output-style.js            # prints the prompt for $SC_OUTPUT_STYLE ('' when off)
node scripts/output-style.js --name      # prints just the resolved name (off|caveman|ponytail)
node scripts/output-style.js --list      # lists every style + a one-line blurb
node scripts/output-style.js --style ponytail   # prints one style's prompt, ignoring the env
```

The style text lives in `lib/output-styles.js` (single source of truth for the CLI and tests).
