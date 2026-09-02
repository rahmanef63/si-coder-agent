---
id: "debug-release-verification-must-be-read-only-by-default"
type: "debug"
title: "Release verification must be read-only by default"
status: "confirmed"
confidence: 1
scope: "repository"
tags: ["verification","recipe","idempotency"]
commit: "bb373954316e4b8ff59da5285cad8a3a49ba7b17+dirty"
supersedes: null
created_at: "2026-09-02T16:47:51.453Z"
last_verified: "2026-09-02T16:46:51.669Z"
issue: "A read-only release check changed recipe state before the verification result was known and one run reported a regression failure."
root_cause: "repositoryVerifyAction observed the release-candidate recipe before running gates and regardless of record=false, so verification was not pure and failed attempts polluted recipe promotion state."
fix: "Observe the recipe only after all gates and persistence succeed, and only when record=true; keep verify:release record=false and return bounded diagnostics."
symptoms: ["recipe observation count increased on a failed verification","first release helper run failed while a direct full test rerun passed"]
failed_attempts: ["initial verify:release run changed recipe state and returned tests=fail"]
verification: ["targeted agent/standalone tests passed","two consecutive verify:release runs passed 304/304","recipe hash and git-status hash stayed unchanged across read-only verification"]
---
