# Setup guide

About 45 minutes, once. You need a Cloudflare account, an OpenAI API account, and admin rights on this repository.

## 1. OpenAI

1. At platform.openai.com, create a project named `ust-listening` and add billing.
2. Create an API key restricted to that project. Keep it for step 3.
3. Set a monthly spending limit on the project. Suggested starting limit: $50.
4. Open the models page and confirm the three model names in `wrangler.jsonc` (`REALTIME_MODEL`, `TRANSCRIBE_MODEL`, `ANALYSIS_MODEL`) are current. Update them if newer versions are listed.

## 2. Cloudflare

1. Create the database:
   ```bash
   npx wrangler login
   npx wrangler d1 create listening
   ```
   Copy the `database_id` it prints into `wrangler.jsonc`.
2. Turnstile: in the dashboard, add a Turnstile widget for your domain (managed mode). Put the **site key** in `TURNSTILE_SITE_KEY` in `wrangler.jsonc`. Keep the **secret key** for step 3.

## 3. Secrets

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put TURNSTILE_SECRET
npx wrangler secret put SESSION_SECRET     # any long random string, for example: openssl rand -base64 48
npx wrangler secret put REVIEWERS          # for example: {"stelar":["you@stthomas.edu"]}
```

This repository is public. Never commit keys, reviewer email addresses, or participant data. All of those live in Cloudflare.

## 4. First deploy

```bash
npm install
npm run db:migrate
npm run deploy
```

Wrangler prints the site address (`https://ust-listening-platform.<account>.workers.dev`). A custom domain can be attached later under Workers, Settings, Domains and Routes.

## 5. Reviewer sign-in (Cloudflare Access)

The dashboard at `/review` returns "sign in" to everyone until this is done.

1. In Cloudflare Zero Trust, choose a team name. Your team domain is `<team>.cloudflareaccess.com`.
2. Access, Applications, Add an application, Self-hosted.
   - Add two paths on your site's hostname: `review` and `api/review`.
   - Policy: Allow, Include, Emails: list each reviewer's address.
   - Login method: One-time PIN works immediately. To use St. Thomas Microsoft sign-in, ITS must add Microsoft Entra ID as an identity provider in Zero Trust, which needs an app registration in the St. Thomas tenant.
3. Copy the application's **Audience (AUD) tag**.
4. In `wrangler.jsonc` set:
   - `ACCESS_TEAM_DOMAIN` to `<team>.cloudflareaccess.com`
   - `ACCESS_AUD` to the AUD tag
5. Update the `REVIEWERS` secret (step 3) whenever the reviewer list changes. Use `"*"` as the key for people who can see every campaign.
6. Commit and push, or run `npm run deploy`.

Reviewers are checked twice: Access decides who can sign in, and `REVIEWERS` decides which campaigns each person can open.

## 6. Automatic deploys from GitHub

1. Cloudflare dashboard, My Profile, API Tokens, Create Token, "Edit Cloudflare Workers" template. Add **D1: Edit** to its permissions.
2. In this repository: Settings, Secrets and variables, Actions. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
3. On the same page, open the Variables tab and add a repository variable `DEPLOY_ENABLED` with the value `true`. Until this is set, pushes are checked but not deployed.
4. Settings, Environments: create `production`. Optional: require your approval before each deploy.

## 7. Before inviting anyone

- [ ] Complete one voice conversation and one typed conversation yourself, on a laptop and a phone.
- [ ] Try it with the microphone permission denied. It should fall back to typing.
- [ ] Submit, then confirm the response and its analysis appear in `/review`.
- [ ] Open `/review` in a private window. It should ask for sign-in.
- [ ] Read the notice text in `campaigns/stelar.ts` and confirm every statement is true for your setup.
- [ ] Confirm the OpenAI spending limit is set.
- [ ] Take down the old pilot site and retire its password.
