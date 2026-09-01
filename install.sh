#!/usr/bin/env bash
# install.sh — portable Agent Skills installer for SI-Coder.
# One skills/ SSOT; symlink into the runtime's user skills directory.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
agent="claude"
custom_dir="${SC_SKILLS_DIR:-}"
with_mcp=0
run_onboarding=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent) agent="${2:?--agent needs claude|codex|hermes|openclaw|all}"; shift 2 ;;
    --skills-dir) custom_dir="${2:?--skills-dir needs a path}"; agent="custom"; shift 2 ;;
    --with-mcp) with_mcp=1; shift ;;
    --no-onboard) run_onboarding=0; shift ;;
    -h|--help)
      cat <<'EOF'
Usage: bash install.sh [options]

  --agent claude|codex|hermes|openclaw|all   target runtime (default: claude)
  --skills-dir PATH                          custom Agent Skills directory
  --with-mcp                                 register local SC MCP where supported
  --no-onboard                               skip interactive credential setup

Claude plugin mode needs no symlink install:
  claude --plugin-dir /path/to/si-coder-agent
EOF
      exit 0 ;;
    *) echo "❌ unknown option: $1" >&2; exit 1 ;;
  esac
done

case "$agent" in
  claude) dirs=("$HOME/.claude/skills") ;;
  codex) dirs=("$HOME/.agents/skills") ;;
  hermes) dirs=("$HOME/.hermes/skills") ;;
  openclaw) dirs=("$HOME/.openclaw/workspace/skills") ;;
  all) dirs=("$HOME/.claude/skills" "$HOME/.agents/skills" "$HOME/.hermes/skills" "$HOME/.openclaw/workspace/skills") ;;
  custom) dirs=("$custom_dir") ;;
  *) echo "❌ unknown --agent $agent" >&2; exit 1 ;;
esac

link_skill() {
  local src="$1" dst_dir="$2" name dst
  name="$(basename "$src")"
  dst="$dst_dir/$name"
  mkdir -p "$dst_dir"
  if [[ -e "$dst" && ! -L "$dst" ]]; then
    echo "❌ refusing to overwrite non-symlink: $dst" >&2
    return 1
  fi
  ln -sfn "$src" "$dst"
  echo "🔗 $dst -> $src"
}

mapfile -t skill_dirs < <(find "$REPO_DIR/skills" -mindepth 1 -maxdepth 1 -type d -print | sort)
for dst in "${dirs[@]}"; do
  echo "📦 Installing SI-Coder Agent Skills into $dst"
  for src in "${skill_dirs[@]}"; do
    [[ -f "$src/SKILL.md" ]] || continue
    link_skill "$src" "$dst"
  done
done

# The npm link gives humans/agents the `sc` command without touching /usr/bin/sc.
if [[ "${SC_SKIP_NPM_LINK:-0}" != "1" ]] && command -v npm >/dev/null 2>&1; then
  (cd "$REPO_DIR" && npm link >/dev/null 2>&1) || true
fi

if [[ "$with_mcp" == "1" ]]; then
  echo ""
  echo "🔌 MCP"
  if [[ "$agent" == "codex" || "$agent" == "all" ]]; then
    if command -v codex >/dev/null 2>&1; then
      if codex mcp get si-coder >/dev/null 2>&1; then
        echo "✅ Codex MCP 'si-coder' already configured"
      else
        codex mcp add si-coder -- node "$REPO_DIR/scripts/sc-mcp.js"
        echo "✅ Registered SI-Coder MCP in Codex"
      fi
    else
      echo "ℹ️ Codex CLI not found. When installed: codex mcp add si-coder -- node '$REPO_DIR/scripts/sc-mcp.js'"
    fi
  fi
  if [[ "$agent" == "claude" || "$agent" == "all" ]]; then
    echo "ℹ️ Claude plugin mode loads .mcp.json automatically: claude --plugin-dir '$REPO_DIR'"
    echo "   Standalone skills can register it manually with: claude mcp add --scope user si-coder -- node '$REPO_DIR/scripts/sc-mcp.js'"
  fi
  if [[ "$agent" == "hermes" || "$agent" == "all" ]]; then
    if command -v hermes >/dev/null 2>&1; then
      if hermes mcp list 2>/dev/null | grep -Fq 'si-coder'; then
        echo "✅ Hermes MCP 'si-coder' already configured"
      else
        hermes mcp add si-coder --command node --args "$REPO_DIR/scripts/sc-mcp.js"
        echo "✅ Registered SI-Coder MCP in Hermes"
      fi
    else
      echo "ℹ️ Hermes CLI not found. When installed: hermes mcp add si-coder --command node --args '$REPO_DIR/scripts/sc-mcp.js'"
    fi
  fi
  if [[ "$agent" == "openclaw" || "$agent" == "all" ]]; then
    if command -v openclaw >/dev/null 2>&1; then
      if openclaw mcp show si-coder >/dev/null 2>&1; then
        echo "✅ OpenClaw MCP 'si-coder' already configured"
      else
        openclaw mcp add si-coder --command node --cwd "$REPO_DIR" --arg "$REPO_DIR/scripts/sc-mcp.js"
        echo "✅ Registered SI-Coder MCP in OpenClaw"
      fi
    else
      echo "ℹ️ OpenClaw CLI not found. When installed: openclaw mcp add si-coder --command node --cwd '$REPO_DIR' --arg '$REPO_DIR/scripts/sc-mcp.js'"
    fi
  fi
fi

echo ""
echo "✅ SI-Coder skills installed for: $agent"
echo "   /sc          → main entry point: describe what you want in plain language"
echo "   /sc-build    → idea → short product interview → first working version → publish"
echo "   /sc-all      → publish an existing app end to end"
echo "   /sc-provider → connect/manage service access safely"
echo "   /sc-install  → portable install guidance"
echo "   Technical CLI (optional): sc deploy plan --json"

[[ -t 0 && -t 1 ]] || run_onboarding=0
if [[ "$run_onboarding" == "1" ]]; then
  echo ""
  read -r -p "Set up credentials now? [Y/n] " _ans
  if [[ ! "$_ans" =~ ^[Nn] ]]; then
    node "$REPO_DIR/bin/sc.js" setup
  fi
else
  echo ""
  echo "Credential setup: sc setup"
  echo "Provider status : sc providers"
  echo "Live verification: sc doctor"
fi
