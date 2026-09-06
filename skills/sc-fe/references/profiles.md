# SI-Coder frontend presets and project profiles

Presets are reusable principles, not visual cloning instructions. They never authorize copying proprietary assets, logos, illustrations, exact layouts, or another product's trade dress. Product requirements, existing coherent design DNA, accessibility, and explicit user instructions always outrank a preset.

## Built-in presets

| Flag | Intent | Biases | Avoid |
|---|---|---|---|
| `--apple` | Native-feeling, calm, direct, content-first ergonomics inspired by Apple HIG principles | clear hierarchy, platform conventions, strong focus/selection, restrained chrome, spatial continuity, contextual controls | pixel-cloning macOS/iOS, copying Apple assets, decorative translucency without purpose |
| `--workbench` | Productivity shell / IDE / admin / agent console | explicit regions, compact toolbars, panes/inspectors, keyboard acceleration, visible state, resizable structure, dense information | marketing hero layouts, cards everywhere, chrome dominating work area |
| `--linear` | Fast issue/project workflow reference | compact density, keyboard speed, strong selection/state, low-friction command surfaces, restrained decoration | cloning Linear assets/layouts, hiding essential actions only to look minimal |
| `--notion` | Content/workspace reference | document-first hierarchy, progressive disclosure, lightweight chrome, flexible blocks, readable editing | copying Notion icons/assets, overusing slash-menu patterns where not useful |
| `--vercel` | Developer-tool precision reference | strong typography, high contrast, semantic status, restrained surfaces, code/data clarity | monochrome-by-default when brand/product requires otherwise, cloning Vercel pages |
| `--material` | Explicit state/feedback and adaptive component reference | semantic interaction states, responsive adaptation, clear elevation/containment when useful | importing Material visual identity wholesale into an existing brand |
| `--editorial` | Reading/storytelling surface | typography, rhythm, measure, image/text hierarchy, low chrome | dashboard density, gratuitous cards, tiny body type |
| `--terminal` | Dense expert tooling | monospace/code-friendly roles, compact rhythm, keyboard operation, explicit status/logs | making everything look like a terminal when graphical controls communicate better |

Shorthand flags are equivalent to `--preset <name>`.

## Existing design DNA is the default profile
When a coherent project UI already exists and the user did not request a redesign, treat it as an implicit `existing` profile. Extract rules from evidence, not from one screenshot:
- tokens/theme variables,
- typography roles,
- spacing rhythm,
- layout regions,
- radius/border/shadow roles,
- color semantics,
- component variants,
- interaction and motion patterns,
- density,
- responsive behavior,
- accessibility conventions.

Distinguish repeated intentional rules from isolated mistakes. Preserve the former and fix the latter.

## Named project profiles
When filesystem writes are available, `--save-profile <name>` writes:

`.sc/frontend/profiles/<name>.json`

Recommended schema:

```json
{
  "version": 1,
  "name": "baton-desktop",
  "source": "existing",
  "intent": "desktop productivity workbench",
  "platform": "desktop",
  "density": "compact",
  "motion": "subtle",
  "layout": {
    "model": "frame-navigation-workarea-inspector",
    "notes": []
  },
  "typography": {
    "roles": [],
    "notes": []
  },
  "tokens": {
    "spacing": [],
    "colorRoles": [],
    "radii": [],
    "borders": [],
    "shadows": []
  },
  "components": {
    "patterns": [],
    "states": []
  },
  "interaction": {
    "keyboard": [],
    "focus": [],
    "feedback": []
  },
  "responsive": {
    "rules": []
  },
  "antiSlop": {
    "avoid": [],
    "allowedWithPurpose": []
  },
  "scopeLocks": [],
  "evidence": {
    "sourceFiles": [],
    "routes": []
  }
}
```

Keep profiles compact and semantic. Store paths/routes as evidence references, not source-code dumps. Do not store secrets, user data, screenshots, binaries, or copied proprietary assets.

## Profile loading
`--profile <name>` loads the project profile before planning changes. If missing, report it as missing rather than silently substituting another profile.

Profiles may extend presets conceptually, but resolved output must be concrete. Example: a project profile can say it uses `workbench` as a reference while overriding density, color, and typography with project-owned tokens.

## Composition examples

```text
/sc-fe --workbench --density compact audit the desktop shell
/sc-fe --apple --motion subtle improve settings
/sc-fe --save-profile baton-desktop
/sc-fe --profile baton-desktop refine the command palette
```

Explicit scope locks remain absolute across profile/preset composition.