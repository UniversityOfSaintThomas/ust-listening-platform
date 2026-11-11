# Setup guide

About 30 minutes, once. You need a Cloudflare account, an OpenAI API account, and admin rights on this repository. No command line is required.

## 1. OpenAI

1. At platform.openai.com, add billing and set a monthly budget. Suggested starting budget: $50.
2. Create an API key named `ust-listening`. Keep it for step 3.
3. Confirm the three model names in `wrangler.jsonc` (`REALTIME_MODEL`, `TRANSCRIBE_MODEL`, `ANALYSIS_MODEL`) are current.

## 2. Cloudflare

1. Create an account. The free plan is enough.
2. My Profile, API Tokens, Create Token, "Edit Cloudflare Workers" template. Add the permission **Account, D1, Edit**. Create the token and keep it for step 3.

## 3. GitHub settings

In this repository: Settings, Secrets and variables, Actions.

Secrets tab:

| Name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | The token from step 2 |
| `OPENAI_API_KEY` | The key from step 1 |
| `DASHBOARD_PASSWORD` | The shared password for the Leadership review page. Use at least 14 characters |
| `REVIEWERS` | Later, in step 5. For example `{"stelar":["you@stthomas.edu"]}` |
| `TURNSTILE_SECRET` | Later, in step 6 |

Variables tab:

| Name | Value |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | The ID in your Cloudflare dashboard address |
| `DEPLOY_ENABLED` | `true` |

This repository is public. Never commit keys, reviewer email addresses, or participant data.

## 4. Deploy

Every push to `main` deploys. To deploy without a code change: Actions, Deploy, Run workflow.

The workflow creates the database on first run, applies migrations, deploys the site, and copies the secrets above into Cloudflare. It also generates the session signing secret once. The site address appears in the Deploy step's log (`https://ust-listening-platform.<account>.workers.dev`).

## 5. Reviewer sign-in

**Shared password (default).** Set the `DASHBOARD_PASSWORD` GitHub secret (step 3) and redeploy. Reviewers open `/review` and enter it. Sign-in lasts 12 hours. Five wrong attempts from one network lock sign-in for 15 minutes. Changing the secret signs everyone out. The password opens every campaign, so share it only with people who should read individual transcripts.

**Named sign-in (optional, stronger).** Cloudflare Access can replace the password with per-person sign-in and per-campaign access:

1. In Cloudflare Zero Trust, choose a team name. Your team domain is `<team>.cloudflareaccess.com`.
2. Access, Applications, Add an application, Self-hosted. Add two paths on your site's hostname: `review` and `api/review`. Policy: Allow, Include, Emails: each reviewer's address.
3. In `wrangler.jsonc` set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` (the application's Audience tag). Commit.
4. Set the `REVIEWERS` GitHub secret, for example `{"stelar":["you@stthomas.edu"]}`. Use `"*"` as the key for people who can see every campaign.
5. Remove the `DASHBOARD_PASSWORD` secret and delete it in Cloudflare (Workers, the app, Settings, Variables and Secrets).

## 6. Bot check (Turnstile)

1. Cloudflare dashboard, Turnstile, Add widget. Hostname: your site address. Mode: Managed.
2. Put the **site key** in `TURNSTILE_SITE_KEY` in `wrangler.jsonc` and commit.
3. Add the **secret key** as the `TURNSTILE_SECRET` GitHub secret.

Until this is done the bot check is off. Rate limits still apply.

## 7. Before inviting anyone

- [ ] Complete one voice conversation and one typed conversation yourself, on a laptop and a phone.
- [ ] Try it with the microphone permission denied. It should fall back to typing.
- [ ] Submit, then confirm the response and its analysis appear in `/review`.
- [ ] Open `/review` in a private window. It should ask for sign-in.
- [ ] Read the notice text in `campaigns/stelar.ts` and confirm every statement is true for your setup.
- [ ] Confirm the OpenAI spending limit is set.
- [ ] Take down the old pilot site and retire its password.
