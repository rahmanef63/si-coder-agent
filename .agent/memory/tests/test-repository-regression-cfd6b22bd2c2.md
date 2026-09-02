---
id: "test-repository-regression-cfd6b22bd2c2"
type: "test"
title: "Repository regression verification"
status: "active"
confidence: 0.7
scope: "repository"
tags: ["regression","security","distribution","agent-workflow"]
commit: "cfd6b22bd2c2bc56c7ab763c063eff97025b98d8"
supersedes: null
created_at: "2026-09-02T16:52:44.757Z"
last_verified: "2026-09-02T16:52:44.757Z"
target: "SI-Coder repository verification"
source: "sc verify"
environment: "node v22.23.2"
steps: ["syntax check","full npm test suite","docs sync check","skill verification",".agent secret scan"]
expected: "all applicable gates pass without persisting secrets"
actual: "syntax=passed, unit_integration_cli_distribution=failed, docs=failed, skills=passed, secret_scan=passed"
result: "fail"
related_areas: ["agent workflow","memory","skills","security","distribution"]
---

Evidence: .agent/evidence/evidence-repository-verification-cfd6b22bd2c2.json
