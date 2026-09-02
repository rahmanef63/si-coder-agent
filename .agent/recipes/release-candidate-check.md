---
id: "release-candidate-check"
name: "release-candidate-check"
status: "executable"
observed_count: 5
last_observed: "2026-09-02T17:18:50.149Z"
scope: "repository"
tags: ["verification","release","security"]
steps: ["syntax check","full regression","docs check","skill verification","agent-state secret scan"]
script: "scripts/release-candidate-check.js"
---
