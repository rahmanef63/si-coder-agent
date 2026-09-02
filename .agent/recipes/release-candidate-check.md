---
id: "release-candidate-check"
name: "release-candidate-check"
status: "executable"
observed_count: 6
last_observed: "2026-09-02T18:24:16.187Z"
scope: "repository"
tags: ["verification","release","security"]
steps: ["syntax check","full regression","docs check","skill verification","agent-state secret scan"]
script: "scripts/release-candidate-check.js"
---
