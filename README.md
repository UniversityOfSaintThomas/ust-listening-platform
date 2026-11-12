# St. Thomas Listening Platform

Voice and text feedback conversations for University of St. Thomas units. A participant opens a link, talks or types with an AI guide for a few minutes, reviews the transcript, and submits. Reviewers see coded themes, a synthesis, and individual responses.

First campaign: **STELAR**. Adding a unit (ITS, Aquinas AI) means adding one file in `campaigns/`.

## How it works

| Piece | Where | Notes |
|---|---|---|
| Participant page | `src/app/Participant.tsx` | Notice, service context, live conversation with captions, editable review, explicit submit |
| Live voice | `src/app/realtime.ts` | Browser connects to the OpenAI Realtime API over WebRTC using a 2-minute client secret |
| Interviewer behavior | `src/worker/prompt.ts` | Built on the server per conversation. The browser cannot change it |
| API | `src/worker/index.ts` | Cloudflare Worker: sessions, submissions, reviewer endpoints, daily cleanup |
| Analysis | `src/worker/analysis.ts` | Codes each response into fixed themes, then synthesizes across responses |
| Reviewer dashboard | `src/app/Dashboard.tsx` at `/review` | Password sign-in |
| Database | `migrations/` | Cloudflare D1 |
| Campaigns | `campaigns/` | Questions, notice text, themes, retention |

## What is stored

Responses are anonymous by design.

- The transcript the participant approved, after an automated step has replaced names, contact details, and similar identifying details with placeholders such as `[name]`. If that step fails, nothing is saved and the participant is asked to submit again.
- The services they selected, an optional role (faculty, staff, student), and an optional ease rating.
- The submission date, to the day.
- No names, no email addresses, no audio, no IP addresses, and no per-visit logs. A salted hash of the IP that rotates daily is kept for 48 hours for rate limiting and is not linked to any submission.
- Transcripts are deleted after the campaign's `retentionDays`.

Participants must tick a statement that they will be talking with an AI guide and that AI tools analyze and report the findings.

Audio and transcript text are processed by OpenAI through its API to run the conversation, the redaction, and the analysis. Under OpenAI's API terms at the time of writing, this data is not used for training and safety logs are kept for up to 30 days. Review the current terms before launch and keep the participant notice in `campaigns/stelar.ts` accurate.

Automated redaction reduces risk. It does not guarantee anonymity: a person can still be recognized from what they describe. Reviewers should delete any response that identifies someone.

## Protections

- Open link, no sign-in for participants.
- Cloudflare Turnstile check before a conversation starts.
- Six conversations per network per hour, and a daily cap per campaign.
- A signed, single-use token is required to submit.
- The OpenAI API key never reaches the browser.
- The reviewer dashboard requires a shared password, with a limit on wrong attempts. Cloudflare Access with a per-campaign reviewer list is supported as a stronger option.

## Documentation

| File | Contents |
|---|---|
| [docs/SPEC.md](docs/SPEC.md) | Requirements and how each is verified |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, data flow, stored data, outside services |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Why it is built this way |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Release, rollback, monitoring, troubleshooting |
| [docs/SETUP.md](docs/SETUP.md) | First-time setup |
| [AGENTS.md](AGENTS.md) | Rules for AI coding assistants |

## Checks

`npm run check` runs the typecheck, lint, tests, and build. The deploy pipeline runs the same checks plus a dependency vulnerability scan, and does not deploy if any fail.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars    # add your OpenAI key
npm run db:migrate:local
npm run dev:api                   # terminal 1, http://localhost:8787
npm run dev:web                   # terminal 2, http://localhost:5173
```

Dashboard locally: http://localhost:5173/review (uses `DEV_REVIEWER_EMAIL`, and add `REVIEWERS={"*":["you@stthomas.edu"]}` to `.dev.vars`).

## Deployment

See [docs/SETUP.md](docs/SETUP.md). After setup, every push to `main` deploys through GitHub Actions.

## Adding a campaign

1. Copy `campaigns/stelar.ts` to `campaigns/its.ts` and edit the text, questions, and themes.
2. Register it in `campaigns/index.ts`.
3. Add its reviewers to the `REVIEWERS` secret (see docs/SETUP.md).
4. Share `https://<your-domain>/c/its`.
