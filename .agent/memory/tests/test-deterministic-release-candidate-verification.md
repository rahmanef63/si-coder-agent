---
id: "test-deterministic-release-candidate-verification"
type: "test"
title: "Deterministic release candidate verification"
status: "confirmed"
confidence: 1
scope: "repository"
tags: ["regression","release","idempotency","security"]
commit: "bb373954316e4b8ff59da5285cad8a3a49ba7b17+dirty"
supersedes: null
created_at: "2026-09-02T16:47:51.541Z"
last_verified: "2026-09-02T16:46:51.669Z"
target: "release-candidate-check"
source: "npm run verify:release"
environment: "node v22.23.2"
steps: ["run full syntax/regression/docs/skills/secret scan","hash recipe and git status","repeat release verification","compare hashes"]
expected: "two consecutive release checks pass without persistent state mutation"
actual: "both checks passed 304/304 with docs, skills and secret scan passing; recipe and git-status hashes were unchanged"
result: "pass"
related_areas: ["agent workflow","recipes","distribution","security"]
symptoms: []
failed_attempts: []
verification: []
---
