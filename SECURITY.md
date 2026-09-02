# Security policy

SI-Coder handles deployment/provider credentials, so security reports should avoid exposing secrets in public issues, logs, screenshots, or reproduction repositories.

## Supported release

Security fixes target the current release line. Historical release notes remain immutable records and are not retroactively rewritten.

## Reporting a vulnerability

When the GitHub repository exposes **Private vulnerability reporting / Security Advisories**, use that channel for sensitive reports. Do not open a public issue containing an API key, token, password, private key, OAuth credential, session secret, or exploitable private infrastructure detail.

If private reporting is temporarily unavailable, keep the sensitive material out of GitHub/public chat and provide only a non-sensitive summary until a private channel is available.

## Credential handling contract

- MCP/machine tools do not accept plaintext provider credential values.
- Fresh local onboarding stores direct credentials in user/provider/named-connection files with mode `0600`; connection directories use `0700`.
- OAuth/provider-managed credentials stay in the external provider/connector and SI-Coder stores only safe routing/status metadata.
- Repository release verification scans the checkout for secret-shaped text before release.
- Secret-shaped `.agent` memory/evidence content is rejected before persistence.

## Artifact provenance

Public release automation generates GitHub artifact attestations for the packaged SI-Coder release assets when the repository supports attestations. Consumers can verify a downloaded artifact with `gh attestation verify <file> -R rahmanef63/si-coder-agent` after public repository availability is restored.
