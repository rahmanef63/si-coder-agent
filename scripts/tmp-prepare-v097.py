import json
from pathlib import Path

ROOT = Path('.')


def replace_once(path, old, new, label):
    p = ROOT / path
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path} {label}: expected one match, got {count}')
    p.write_text(text.replace(old, new, 1))


def append_once(path, marker, block):
    p = ROOT / path
    text = p.read_text()
    if marker not in text:
        p.write_text(text.rstrip() + '\n\n' + block.strip() + '\n')

# README: add discoverability guidance before the normal workflow section.
readme = ROOT / 'README.md'
text = readme.read_text()
if '### Find skills by keyword' not in text:
    block = r'''
### Find skills by keyword

Skill discovery is **not tag-only**. SC ranks the canonical name/slash invocation, Agent Skills `description`, derived/declared tags, aliases, and scope/source context. Existing skills remain searchable without a metadata migration because missing search metadata is derived at index time.

```bash
sc skills ui
sc skills "accessibility mobile"
sc-skill ui
sc-skill "deploy production"
```

The Finder/TUI uses the same fuzzy, multi-token matcher, so typing `interfce` in **Skills** can still surface interface/UI skills.

For new skills, do not maintain a taxonomy by hand. Use:

```bash
sc-skill --new
```

In a non-interactive agent shell, that returns the machine-readable creation/install contract: what is required, what SC derives automatically, and how to verify the new skill. A concise new skill can be created with:

```bash
sc-skill --new ui-audit \
  --description "Audit visual hierarchy, spacing, typography, responsive states, accessibility, and design-system consistency."
```

SC derives `metadata.sc.tags` and `metadata.sc.aliases` from the skill's name, `description`, and `use_when`. Manual `--tags` / `--aliases` are correction tools only. A precise `description` remains the primary discovery/activation metadata.

To install an existing Agent Skill that contains scripts, references, assets, or templates, preserve the whole bundle:

```bash
sc-skill --new --from-dir ./downloaded-skill
```

The bundle is inspected/copied without following symlinks, bounded by file/byte limits, validated as a skill, and rolled back on failure. Use `--from-file SKILL.md` only for a truly single-file skill.
'''
    text = text.replace('\n## The normal workflow\n', '\n' + block.strip() + '\n\n## The normal workflow\n', 1)
    readme.write_text(text)

# sc-help routes skill discovery/installation explicitly.
replace_once(
    'skills/sc-help/SKILL.md',
    '| Agent Experience/tool/project ergonomics audit | `sc-ax` |\n| Existing app: publish from repo to production | `sc-all` |',
    '| Agent Experience/tool/project ergonomics audit | `sc-ax` |\n| Find/install/create an Agent Skill by capability | `sc-skill` |\n| Existing app: publish from repo to production | `sc-all` |',
    'sc-skill route row',
)

append_once('docs/cli.md', '## Fuzzy skill discovery', r'''
## Fuzzy skill discovery

`sc`, `sc skills`, and `sc-skill` share the same discovery model instead of maintaining separate skill lists.

```bash
sc skills ui
sc skills "accessibility mobile"
sc-skill interface
sc-skill "deploy production"
```

The index combines canonical name/invocation, Agent Skills description, `metadata.sc.tags`, `metadata.sc.aliases`, scope, and source. Missing SC metadata is derived dynamically for older skills, so existing installations do not need a manual retag migration.

The Finder filter is fuzzy and multi-token across the current column. Skills additionally expose hidden `searchText` containing their description, tags, aliases, scope, and source. This keeps one search behavior across Users, Providers, Skills, and other Finder sections.

### Creating or installing a skill

```bash
sc-skill --new
sc-skill --new ui-audit --description "Audit UI hierarchy, responsive states, and design-system consistency."
sc-skill --new --from-dir ./downloaded-skill --scope project
```

`sc-skill --new` without enough non-interactive inputs prints a machine-readable contract for an agent rather than guessing. Tags and aliases are automatic by default; pass `--tags` or `--aliases` only to correct the derived taxonomy.
''')

# Current installation links advance to 0.9.7. Historical release notes remain historical.
current_docs = [
    'README.md', 'AI_INSTALL.md', 'references/portable-skills.md',
    'docs/install/README.md', 'docs/install/claude-code.md', 'docs/install/claude-web.md',
    'docs/install/codex.md', 'docs/install/chatgpt-skills.md', 'docs/install/generic-local.md',
]
for rel in current_docs:
    p = ROOT / rel
    p.write_text(p.read_text().replace('v0.9.6', 'v0.9.7'))

old = ROOT / 'docs/releases/v0.9.6.md'
old_text = old.read_text()
if 'Historical release record' not in old_text:
    old.write_text(old_text.replace('# ', '> Historical release record. Current installation links are documented in the latest release.\n\n# ', 1))

release = r'''# SI-Coder v0.9.7

SI-Coder v0.9.7 makes Skills discoverable by capability instead of requiring users to memorize exact names, and adds an agent-friendly `sc-skill --new` creation/install contract.

## Skill discovery index

- `sc skills <keywords>` and `sc-skill <keywords>` perform ranked multi-token capability search.
- The Finder/TUI uses one shared fuzzy matcher across columns; Skills add description, tags, aliases, scope, and source to their searchable text.
- Agent Skills `name` + `description` remain the primary discovery metadata.
- `metadata.sc.tags` and `metadata.sc.aliases` are optional client-side search hints, not a replacement for a precise description.
- Existing skills require no manual migration: missing tags/aliases are derived at index time.
- Typo-tolerant fuzzy matching and multi-token AND search are covered by regression tests.

## `sc-skill --new`

- Non-interactive `sc-skill --new` returns a machine-readable contract describing required inputs, automatic metadata, safe installation, and verification.
- Newly typed names normalize to the Agent Skills lowercase-hyphen convention.
- Tags and aliases are derived automatically; manual values are explicit corrections and survive later description edits.
- `--from-dir` installs the complete Agent Skill bundle, including scripts/references/assets, while rejecting symlinks and bounded-install violations.
- Invalid installs/updates roll back instead of leaving partial skill state.

## Compatibility

The existing cross-host registry envelope remains version 1 with `source`, `contract`, and `skills`. Search adds `query`/`count` without removing existing fields. The slash contract remains `/skills`, `/<skill> [prompt]`, and `/skill <exact-id> [prompt]`.

<!-- INSTALL_MATRIX_GENERATED:BEGIN -->
placeholder
<!-- INSTALL_MATRIX_GENERATED:END -->
'''
(ROOT / 'docs/releases/v0.9.7.md').write_text(release)

for rel in ['.claude-plugin/plugin.json', 'plugins/si-coder/.codex-plugin/plugin.json']:
    p = ROOT / rel
    data = json.loads(p.read_text())
    data['version'] = '0.9.7'
    p.write_text(json.dumps(data, indent=2) + '\n')
