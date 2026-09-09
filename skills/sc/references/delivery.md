# Delivery from project initiation to CI/CD

Read this for a new project, production launch, auth/email setup, domain migration,
or release automation. Resume from verified evidence; do not rerun completed
provisioning. This workflow applies to the user's selected services, not a mandate
to buy, migrate to, or add every service mentioned below.

## 1. Establish the delivery contract

Inspect the canonical repo, AGENTS instructions, branch, dirty work, lockfile,
active framework/adapter, backend deployment, provider bindings and live revision.
Trace the real UI → server/function → provider path before editing.
Reuse existing auth, mail helpers, tests and release commands.

Record only non-secret facts in the project's existing runbook/setup records:
owner, repo/branch, selected provider resource IDs, environment, build command,
release command, current/desired domains, capability requirements, rollout owner,
last known-good revision and evidence time. Existing Svelte/Clerk/managed Convex
must not be replaced because an older starter used Next/Convex Auth/self-hosting.

For a new project, infer a focused product brief: actors, core action, data,
required login/recovery/invitation/payment flows, and acceptance criteria. Reuse
an authorized repository or create one only within the requested build workflow.
Install with the project's package manager and lockfile. Fix dependency errors;
do not erase an existing app or globally apply legacy peer-dependency bypasses.

## 2. Bind infrastructure and secrets to the correct environment

Prefer discovered project functions, connected provider tools and safe secret
projection. A connected VPS runner is a valid execution route even when the
conversation itself runs in a browser. Missing Composio is not a blocker when an
authorized equivalent is available. Consult live tool schemas/provider docs.

For every required variable, record:
`name | consumer | environment | public/secret | secret reference | status`.
Frontend build values, frontend server values, Convex function env, deployment
credentials and provider settings are separate destinations.
A local dotenv file or frontend-host env does not configure a Convex action.

Use least-privilege named connections. Keep values in the provider/host credential service/SC secret
store or destination; no keys in Git URLs, argv, chat, logs, screenshots, skill
files or the project control plane documents. Verify names/presence/capabilities without dumping env.
Use a dotenv parser or the runtime's env-file support; never shell-source dotenv
files (deploy keys can contain shell metacharacters). Remove conflicting ambient
deployment selectors in the child process before loading the authoritative file.
Do not remove unrelated env variables or rotate keys merely to diagnose access.

## 3. Resolve domains by purpose

Keep a map of web origin, API/realtime origin, HTTP Actions/Auth origin, review
host, email sender domain and DNS authority. These may differ.
Read authoritative nameservers and destination-required DNS records before writes.
A Cloudflare account does not prove Cloudflare serves the zone.
A provider duplicate error is a no-op only after inspecting the existing resource
and confirming it matches the intended target; other 4xx errors remain errors.

For a migration: attach and verify the new target, update the exact consumer
configuration, legal/canonical URLs, OAuth allowlists, issuer/callbacks and email
identity where applicable, then verify HTTPS and the actual user flow.
Keep working old routes during transition; remove them only with explicit scope
and evidence no caller depends on them. Do not globally replace every old domain.
Managed Convex uses provider-issued records, not assumed VPS A records.

## 4. Complete the requested auth and legal flows

Read the installed auth adapter and the provider's current documentation.
For Convex Auth + Google, the redirect is the actual HTTP Actions/Auth origin
plus `/api/auth/callback/google`, not the frontend or realtime/API origin.
Confirm OAuth project/client, JavaScript origins, exact redirect, minimal scopes,
support/contact identity, authorized domain and audience status.
Cloud project display name and immutable project ID need not match the new brand.

Publish reachable Privacy Policy and Terms pages describing actual data use,
processors, account/deletion/contact paths and acceptable use. Link them in the
public footer/login and OAuth branding. Do not invent retention guarantees,
certifications, legal entities or policies the product does not implement.
Record missing owner decisions; do not present a draft as legal certification.

Implement requested login, registration, sign-out, recovery and invitation paths
using the existing auth provider. Env configured ≠ backend deployed ≠ button
rendered ≠ OAuth callback succeeded. Query the correct production capability,
deploy changed provider code, and inspect the signed-out UI after hydration.
An authenticated session redirecting to the workspace is not a missing-button
test. Use an authorized test session without signing the user's session out.

Check Testing versus Production and any separate branding/scope verification.
Existing launch approval may authorize publishing; do not ask again reflexively.
Report provider review still pending even if publishing succeeded. Never claim
an OAuth login succeeded from configuration or a capability boolean alone.

### Separate-account OAuth acceptance

Include a first-time account distinct from the app owner, an existing account,
sign-out/reload, and cancellation/retry in the acceptance matrix. Reaching the
Google account chooser proves handoff only. A successful callback HTTP redirect
still does not prove a persisted session and access to the user's workspace.
Preserve the user's failed manual result as unresolved evidence. Determine where
it fails: provider audience/policy, callback exchange, cookie/session propagation,
account linking or onboarding. Read bounded sanitized logs on the correct
production deployment. Never broaden scopes or weaken account linking to make
a different account pass. Display a safe recovery message for callback failure;
never reflect raw provider descriptions, OAuth codes, verifiers or tokens.

## 5. Verify transactional email through the real app

Choose the intended Resend account and verified sending domain; do not infer the
sender from the website hostname. Preserve mailbox MX records and existing SPF/
DMARC policy; apply the exact provider records to the authoritative zone.
Use a sending-only, domain-restricted key where supported and store it at the
actual sending backend. Set the existing app's sender variable, with project
display name and optional monitored Reply-To. Do not add a second mail client.

Test the actual reset/invite action using an explicitly authorized recipient.
Record provider message ID, status and timestamp, never the body/reset code.
A neutral reset response or API success alone does not prove delivery; inspect
provider delivery events. Do not change a real user's password during a send test.
For a dedicated test account, verify expiry/reuse rejection and successful
recovery where authorized. Preserve rate limits and account-enumeration defenses.
Never weaken password hashing or accept plaintext to work around a timeout.

If the dedicated provider skill is a stub, use available provider tools/current
docs through sc-provider; do not label the unfinished automation implemented.

## 6. Establish CI and a single release path

Use the repository's canonical gate: frozen install, relevant type/lint/tests,
production build, and required security checks. PR validation must not receive
production credentials or deploy untrusted fork code.
Document whether CD is automatic, operator-triggered, or absent. A webhook or
green build alone is not proof of CI/CD.

For requested CI/CD, wire the chosen release path to successful checks for the
same commit and trusted branch. Scope credentials to the deployment environment;
serialize production rollouts and prevent stale runs from replacing newer ones.
Use one rollout owner across agents. If another agent is releasing, prepare the
isolated change and pass its exact commit/evidence to that owner.

Backend and frontend are separate release steps even in a combined command.
Deploy compatible backend changes before dependent UI; use migrations and
rollback planning appropriate to the schema change.
For managed Convex, explicitly select production on operational CLI commands
that support it (for example env/run with `--prod`), and verify the deployment
identity. Frontend redeploy alone does not publish Convex functions.
Use the repository's release wrapper ahead of generic provider scripts.

For Dokploy, preserve the actual source mode. Git mode must build the intended
commit. Drop mode must publish a clean archive of the verified commit, preserve
server-managed env, project public revision metadata, then queue one rollout.
A Git push does not update a drop-source directory.
Never inject placeholder backend URLs into a production browser bundle.

## 7. Acceptance, rollback and handoff

Wait for a terminal deployment result with bounded polling, then require the
live no-store health endpoint to match the expected revision/version.
Verify applicable DNS/TLS, backend capabilities, signed-out and signed-in UI,
OAuth callback, recovery delivery, core persisted action and responsive layout.
HTTP 200, screenshots before hydration, source-string tests and capability flags
are different evidence levels; none substitutes for a complete user journey.

Persist revision, deployment ID, time, checks, provider status, known gaps and
rollback target without secrets. Mark configured, deployed and verified
separately. Keep external-review or missing-permission items pending with an owner.
Rollback means the last known-good app artifact plus compatible backend/config;
do not assume rolling back the frontend reverts data migrations or provider state.
Do not retry an unchanged failed rollout indefinitely.

The project control plane is the planning/evidence layer; authorized provider tools execute
infrastructure operations. Bind resources and secret references, never secret
values. Update existing setup/QA/runbook records under project RBAC. Do not mark
Shipped from a build alone or invent a project control-plane tool that is absent from discovery.

For frontend changes, use sc-fe's shared frontend contracts. Record real repository
diagrams by immutable revision and actual dependency evidence; label bounded static
analysis and unsupported/private-repo access explicitly.

## Sources to recheck when implementing

- [Convex Auth Google](https://labs.convex.dev/auth/config/oauth/google)
- [Convex production env](https://docs.convex.dev/production/environment-variables)
- [Resend API keys](https://resend.com/docs/dashboard/api-keys/introduction)
- [GitHub deployments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments)

Keep volatile host IDs, domains, account names, revisions and delivery receipts in
the project runbook, not this reusable skill.
