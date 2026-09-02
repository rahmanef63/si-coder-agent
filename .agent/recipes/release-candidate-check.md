---
id: "release-candidate-check"
name: "release-candidate-check"
status: "executable"
observed_count: 4
last_observed: "2026-09-02T17:06:57.771Z"
scope: "repository"
tags: ["verification","release","security"]
steps: ["syntax check","full regression","docs check","skill verification","agent-state secret scan"]
script: "scripts/release-candidate-check.js"
---
