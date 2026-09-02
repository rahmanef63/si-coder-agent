#!/usr/bin/env python3
"""Build SI-Coder web/import artifacts from the canonical Agent Skills source.

The editable source remains skills/*/SKILL.md. The .skill artifact is a ZIP archive,
matching Anthropic's distributable skill packaging convention. A .zip twin is emitted
because current Claude.ai documentation explicitly describes ZIP uploads and it is a
safe fallback for other Agent Skills importers.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import stat
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
CORE_REFS = ["sc-build", "sc-all", "sc-provider", "sc-install", "sc-help"]
OPENAI_PLUGIN_SKILLS = ["sc", "sc-build", "sc-all", "sc-provider", "sc-install", "sc-help"]
REPO_REFS = ["provider-routing.md", "portable-skills.md", "output-styles.md"]
FIXED_ZIP_TIME = (1980, 1, 1, 0, 0, 0)


def add_tree(zipf: zipfile.ZipFile, skill_dir: Path) -> None:
    parent = skill_dir.parent
    for path in sorted(skill_dir.rglob("*")):
        if not path.is_file():
            continue
        if any(part in {"node_modules", "__pycache__", ".git"} for part in path.parts):
            continue
        if path.name in {".DS_Store"} or path.suffix == ".pyc":
            continue
        rel = path.relative_to(parent).as_posix()
        info = zipfile.ZipInfo(rel, date_time=FIXED_ZIP_TIME)
        info.create_system = 3
        # ZIP metadata must be independent from the checkout umask/group-write policy.
        # Preserve only the semantic executable bit; canonicalize regular files to 0644
        # and executables to 0755 so CI/local packaging is byte-for-byte identical.
        source_mode = stat.S_IMODE(path.stat().st_mode)
        mode = 0o755 if source_mode & 0o111 else 0o644
        info.external_attr = (stat.S_IFREG | mode) << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        zipf.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)


def package(skill_dir: Path, out: Path) -> None:
    if not (skill_dir / "SKILL.md").is_file():
        raise SystemExit(f"missing SKILL.md: {skill_dir}")
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        add_tree(zf, skill_dir)


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def build_web_sc(stage_root: Path) -> Path:
    dst = stage_root / "sc"
    shutil.copytree(ROOT / "skills" / "sc", dst)
    refs = dst / "references" / "si-coder"
    refs.mkdir(parents=True, exist_ok=True)
    for skill in CORE_REFS:
        shutil.copy2(ROOT / "skills" / skill / "SKILL.md", refs / f"{skill}.md")
    for name in REPO_REFS:
        src = ROOT / "references" / name
        if src.exists():
            shutil.copy2(src, refs / name)
    scripts = dst / "scripts"
    scripts.mkdir(exist_ok=True)
    shutil.copy2(ROOT / "lib" / "product-interview.js", scripts / "product-interview.js")
    (refs / "INDEX.md").write_text(
        "# Bundled SI-Coder workflows\n\n"
        "This directory is generated for the standalone web/import package. "
        "The canonical editable sources live in the repository's `skills/` and `references/` directories.\n\n"
        + "\n".join(f"- `{name}.md`" for name in CORE_REFS)
        + "\n",
        encoding="utf-8",
    )
    return dst


def build_openai_plugin() -> None:
    """Generate the skill-only OpenAI plugin from canonical skill sources."""
    version = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
    plugin = ROOT / "plugins" / "si-coder"
    skills_dst = plugin / "skills"
    if skills_dst.exists():
        shutil.rmtree(skills_dst)
    skills_dst.mkdir(parents=True, exist_ok=True)
    for name in OPENAI_PLUGIN_SKILLS:
        shutil.copytree(ROOT / "skills" / name, skills_dst / name)
    manifest_dir = plugin / ".codex-plugin"
    manifest_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "name": "si-coder",
        "version": version,
        "description": "Build and publish web apps from plain-language goals with a non-technical workflow.",
        "author": {"name": "Rahman EF", "url": "https://github.com/rahmanef63"},
        "homepage": "https://github.com/rahmanef63/si-coder-agent",
        "repository": "https://github.com/rahmanef63/si-coder-agent",
        "license": "MIT",
        "keywords": ["web-apps", "agent-skills", "deployment", "no-code", "workflow"],
        "skills": "./skills/",
        "interface": {
            "displayName": "SI-Coder",
            "shortDescription": "Build and publish web apps from plain language",
            "longDescription": "SI-Coder turns a non-technical product idea into a working web app, chooses sensible technical defaults, and guides secure publishing and account connections.",
            "developerName": "Rahman EF",
            "category": "Developer Tools",
            "defaultPrompt": [
                "Build a web app from my idea.",
                "Publish this app and connect my domain.",
                "Help me improve this web app."
            ]
        }
    }
    (manifest_dir / "plugin.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (plugin / "GENERATED.md").write_text(
        "# Generated OpenAI plugin\n\n"
        "Do not edit the copied skills here. Canonical sources live under `/skills`. "
        "Regenerate with `npm run package:skills`.\n",
        encoding="utf-8",
    )


def main() -> None:
    DIST.mkdir(exist_ok=True)
    build_openai_plugin()
    for old in [DIST / "sc.skill", DIST / "sc.zip", DIST / "sc-build.skill"]:
        if old.exists():
            old.unlink()
    with tempfile.TemporaryDirectory(prefix="si-coder-skill-") as td:
        stage = Path(td)
        web_sc = build_web_sc(stage)
        package(web_sc, DIST / "sc.skill")
        shutil.copy2(DIST / "sc.skill", DIST / "sc.zip")
        package(ROOT / "skills" / "sc-build", DIST / "sc-build.skill")

    manifest = {
        "format": "agent-skills",
        "source": "skills/*/SKILL.md",
        "artifacts": [
            {"file": name, "sha256": digest(DIST / name), "bytes": (DIST / name).stat().st_size}
            for name in ["sc.skill", "sc.zip", "sc-build.skill"]
        ],
    }
    (DIST / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
