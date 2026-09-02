---
id: "test-repository-regression-bb373954316e-dirty"
type: "test"
title: "Repository regression verification"
status: "confirmed"
confidence: 1
scope: "repository"
tags: ["regression","security","distribution","agent-workflow"]
commit: "bb373954316e4b8ff59da5285cad8a3a49ba7b17+dirty"
supersedes: null
created_at: "2026-09-02T16:42:23.788Z"
last_verified: "2026-09-02T16:42:23.788Z"
target: "SI-Coder repository verification"
source: "sc verify"
environment: "node v22.23.2"
steps: ["syntax check","full npm test suite","docs sync check","skill verification",".agent secret scan"]
expected: "all applicable gates pass without persisting secrets"
actual: "syntax=passed, unit_integration_cli_distribution=passed, docs=passed, skills=passed, secret_scan=passed"
result: "pass"
related_areas: ["agent workflow","memory","skills","security","distribution"]
---

Evidence: .agent/evidence/evidence-repository-verification-bb373954316e-dirty.json
