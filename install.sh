#!/usr/bin/env bash
# install.sh — symlink each sc-* skill into ~/.claude/skills/ so they show as /sc-* slash commands.
# Idempotent: re-running replaces existing symlinks safely. Aborts if a non-symlink path exists.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${SC_SKILLS_DIR:-$HOME/.claude/skills}"

mkdir -p "$TARGET_DIR"

link_skill() {
  local name="$1"
  local src="$REPO_DIR/skills/$name"
  local dst="$TARGET_DIR/$name"

  if [[ ! -d "$src" ]]; then
    echo "⚠️  skipping $name (not found in repo: $src)"
    return
  fi

  if [[ -e "$dst" && ! -L "$dst" ]]; then
    echo "❌ refusing to overwrite non-symlink: $dst"
    echo "   Move it aside first, then re-run install.sh."
    exit 1
  fi

  ln -sfn "$src" "$dst"
  echo "🔗 linked $dst -> $src"
}

echo "📦 Installing sc-* skills into $TARGET_DIR"

link_skill "sc-all"
link_skill "sc-convex"
link_skill "sc-convex-cloud"
link_skill "sc-dokploy"
link_skill "sc-onboarding"
link_skill "sc-vercel"

# --- Stubs (boilerplate only, NOT IMPLEMENTED YET). Linked so they appear as
# discoverable slash commands; each script exits with code 2 + a TODO pointer.
link_skill "sc-cf"
link_skill "sc-stripe"
link_skill "sc-resend"
link_skill "sc-clerk"
link_skill "sc-supabase"

# Optional: legacy umbrella as /use-si-coder remains in ~/.agents/skills/si-coder/ (unchanged).
echo ""
echo "✅ done. Available slash commands:"
echo "   /sc-all          → end-to-end deploy"
echo "   /sc-dokploy      → Dokploy CRUD/audit/debug"
echo "   /sc-convex       → Convex self-hosted ops"
echo "   /sc-convex-cloud → Convex Cloud (managed) deploy"
echo "   /sc-vercel       → Vercel online frontend deploy"
echo "   /sc-onboarding   → credential setup wizard"
echo ""
echo "Stubs (boilerplate only, scripts exit code 2 until implemented):"
echo "   /sc-cf           → Cloudflare DNS/Workers/Pages/R2"
echo "   /sc-stripe       → Stripe products/webhooks/portal"
echo "   /sc-resend       → Resend domain verify + send"
echo "   /sc-clerk        → Clerk provisioning (pair with Clerk MCP for code)"
echo "   /sc-supabase     → Supabase backend alternative"
echo ""
echo "Legacy /use-si-coder remains parallel (in ~/.agents/skills/si-coder/)."
