---
id: "decision-v0-9-1-release-boundary"
type: "decision"
title: "v0.9.0 stays immutable; follow-up ships as v0.9.1"
status: "confirmed"
confidence: 1
scope: "repository"
tags: ["release","versioning","docs"]
commit: "1936ff16fd8c7fd3466f922ad7e83913f221ea9c+dirty"
supersedes: null
created_at: "2026-09-02T18:48:30.334Z"
last_verified: null
decision: "Keep v0.9.0 immutable and publish post-tag changes as v0.9.1"
---

The v0.9.0 tag remains an immutable historical release boundary. Post-v0.9.0 changes to the simplified README, GitHub direct PAT-classic setup, Finder Esc/input behavior, taller INFO/PREVIEW panel, documentation availability claims, and cleanup are published as v0.9.1 instead of retagging or rewriting v0.9.0. Older release notes retain their original release-specific wording and are explicitly marked historical; current installation guidance is owned by docs/install/README.md and generated into the current README/release note.
