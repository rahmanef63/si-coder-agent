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
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
CORE_REFS = ["sc-build", "sc-all", "sc-provider", "sc-install", "sc-help"]
REPO_REFS = ["provider-routing.md", "portable-skills.md", "output-styles.md"]


def add_tree(zipf: zipfile.ZipFile, skill_dir: Path) -> None:
    parent = skill_dir.parent
    for path in sorted(skill_dir.rglob("*")):
        if not path.is_file():
            continue
        if any(part in {"node_modules", "__pycache__", ".git"} for part in path.parts):
            continue
        if path.name in {".DS_Store"} or path.suffix == ".pyc":
            continue
        zipf.write(path, path.relative_to(parent))


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


def main() -> None:
    DIST.mkdir(exist_ok=True)
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
