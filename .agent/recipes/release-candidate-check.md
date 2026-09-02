---
id: "release-candidate-check"
name: "release-candidate-check"
status: "executable"
observed_count: 7
last_observed: "2026-09-02T18:47:52.191Z"
scope: "repository"
tags: ["verification","release","security"]
steps: ["syntax check","full regression","docs check","skill verification","agent-state secret scan"]
script: "scripts/release-candidate-check.js"
---
