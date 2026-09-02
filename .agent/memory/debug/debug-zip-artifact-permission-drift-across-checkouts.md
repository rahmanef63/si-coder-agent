---
id: "debug-zip-artifact-permission-drift-across-checkouts"
type: "debug"
title: "ZIP artifact permission drift across checkouts"
status: "confirmed"
confidence: 1
scope: "repository"
tags: ["distribution","determinism","release","zip"]
commit: "7f177ff3a792d8e32c654cb8f7a730d41fa1c4fb+dirty"
supersedes: null
created_at: "2026-09-02T17:16:55.817Z"
last_verified: "2026-09-02T17:15:00.000Z"
issue: "Rebuilding sc.skill on a 0644 checkout changed its hash from the committed artifact even though entry contents were identical."
root_cause: "package-web-skill.py copied source permission bits into ZIP external_attr; two generated reference files had been packaged previously from 0664 files, while CI/current checkout used 0644."
fix: "Canonicalize ZIP regular files to 0644 and executables to 0755 based only on the semantic execute bit."
---
