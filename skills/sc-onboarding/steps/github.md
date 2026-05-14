# GitHub credentials

## `GITHUB_TOKEN` (required)

A GitHub Personal Access Token. Used by `sc-all` and `sc-convex` to create private repos and push code via HTTPS.

**Scopes required**: `repo` (full).

**How to get one**:
1. Open https://github.com/settings/tokens/new
2. Name it `si-coder-agent`
3. Tick `repo`
4. Generate → copy the `ghp_…` token (you only see it once)

**Validator**: starts with `ghp_` or `github_pat_`, length ≥ 40.

**SSH push (separate)**: The deploy scripts also push via SSH (`git@github.com:user/repo.git`). Ensure `ssh -T git@github.com` succeeds; if not, add your key at https://github.com/settings/keys.
