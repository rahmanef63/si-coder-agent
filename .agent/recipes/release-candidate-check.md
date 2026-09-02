---
id: "release-candidate-check"
name: "release-candidate-check"
status: "executable"
observed_count: 3
last_observed: "2026-09-02T16:47:11.734Z"
scope: "repository"
tags: ["verification","release","security"]
steps: ["syntax check","full regression","docs check","skill verification","agent-state secret scan"]
script: "scripts/release-candidate-check.js"
verified_at: "2026-09-02T16:47:11.796Z"
promoted_at: "2026-09-02T16:47:11.855Z"
---
