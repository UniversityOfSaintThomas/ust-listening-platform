# Operations

How to release, check, roll back, and respond to problems.

## Releasing a change

1. Run `npm run check` locally. It runs the typecheck, lint, tests, and build.
2. Try it on staging: Actions, "Deploy staging", Run workflow. Test at the staging address.
3. Merge or commit to `main`. The Deploy workflow runs the same checks, scans dependencies, applies migrations, and deploys.
4. Run the pre-release checklist below against production.

A failed check stops the deploy. The live site stays on the previous version.

## Pre-release checklist

- [ ] The Begin button is disabled until the AI disclosure box is ticked
- [ ] One voice conversation: the guide waits through a pause, stops when interrupted, and captions appear
- [ ] One typed conversation
- [ ] With the microphone blocked, the page falls back to typing
- [ ] The review screen allows editing, removing, and discarding
- [ ] A submission appears on the review page with its analysis, and names are replaced with placeholders
- [ ] The review page refuses a wrong password
- [ ] Keyboard only: every control is reachable and shows focus
- [ ] Phone width: no sideways scrolling

## Rolling back

Fastest: in the Cloudflare dashboard, open Workers and Pages, the application, Deployments, and choose "Rollback" on the last good version. This takes effect in seconds.

Then fix forward in Git so the repository matches what is running. Database migrations are additive and are not reversed by a rollback.

## Monitoring

| What | Where |
|---|---|
| Deploy results | GitHub, Actions |
| Application errors | Cloudflare dashboard, the application, Observability. Search for `Redaction`, `Analysis failed`, `Client secret request failed`, `Unhandled error` |
| Usage and cost of AI calls | OpenAI platform, Usage. A monthly budget is set there |
| Bot check pass rate | Cloudflare dashboard, Turnstile |

Not yet in place: alerts. Add a Cloudflare notification for Worker error rate, and an OpenAI budget alert email.

## If something goes wrong

| Symptom | Likely cause | Action |
|---|---|---|
| "The listening guide is unavailable" | AI key invalid, out of credit, or model name retired | Check the Observability log line for the provider's error. Update the `OPENAI_API_KEY` secret or the model names in `wrangler.jsonc` |
| "Your response could not be saved" | De-identification step failing | Check logs for `Redaction`. Participants can retry. Nothing unredacted is stored |
| "We could not confirm your browser" | Bot check misconfigured | Confirm the site's hostname is listed on the Turnstile widget and `TURNSTILE_SECRET` is current |
| A stored response identifies someone | De-identification missed it | Delete the response from the review page |
| Suspected misuse or cost spike | Automated traffic | Lower `dailySessionCap` in the campaign file, or set the campaign `status` to `closed`, and deploy |

## Rotating keys and the password

Replace the value under GitHub, Settings, Secrets and variables, Actions. Then run the Deploy workflow by hand. Changing `DASHBOARD_PASSWORD` signs every reviewer out.

## Closing a campaign

Set `status: "closed"` in the campaign file and deploy. To remove its data, delete responses from the review page, or wait for retention.

## Ownership

| Item | Owner today | Target |
|---|---|---|
| Cloudflare account | Jonathan Keiser | University-owned |
| OpenAI API account | Jonathan Keiser | University-owned or replaced by a university-contracted model |
| GitHub repository | UniversityOfSaintThomas organization | Unchanged |
