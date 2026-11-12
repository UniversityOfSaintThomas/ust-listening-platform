# Specification

What this system must do, and how to tell that it does. Change this file before changing behavior.

## Purpose

Collect candid feedback about a St. Thomas unit's services through a short conversation with an AI guide, and give that unit's leadership themes and de-identified transcripts to act on. First campaign: STELAR.

## Users

| User | Needs |
|---|---|
| Participant (faculty, staff, student) | To give feedback in five to eight minutes, by voice or text, without signing in, knowing what happens to it |
| Reviewer (unit leadership) | To see recurring strengths, friction, and requests, read the responses behind them, and export the data |
| Owner (the unit running a campaign) | To launch a campaign by editing one file, and to operate the site without a command line |

## Requirements

Each requirement lists how it is verified. "Test" names an automated test in `tests/`. "Manual" means the pre-release checklist in `docs/OPERATIONS.md`.

### Participation

| ID | Requirement | Verified by |
|---|---|---|
| P1 | A participant must tick an AI disclosure statement before a conversation can start. The server refuses to start without it. | Manual; server rule in `startSession` |
| P2 | The notice states the purpose, that taking part is voluntary, what is stored, who processes it, and who reads it. | Test: `campaigns.test.ts` |
| P3 | Voice and text are both offered. A participant using voice can type at any point. Captions are always shown. | Manual |
| P4 | The guide says it is an AI, asks each core question, probes vague answers for one concrete example, and reads back a summary. | Test: `campaigns.test.ts` (instructions); Manual (behavior) |
| P5 | The guide never asks for identifying details and does not repeat them. | Test: `campaigns.test.ts`; Manual |
| P6 | Nothing is saved until the participant reviews the transcript and chooses to submit. They can edit, remove, or discard. | Manual |
| P7 | The pages meet WCAG 2.1 AA: keyboard operable, visible focus, labeled controls, contrast, reduced motion. | Manual |

### Privacy

| ID | Requirement | Verified by |
|---|---|---|
| D1 | No names, email addresses, IP addresses, audio, or per-request logs are stored. | Code review; `migrations/`; `wrangler.jsonc` |
| D2 | Identifying details in a transcript are replaced with placeholders before it is stored. | Test: `redaction.test.ts` |
| D3 | If de-identification fails or returns an unfaithful result, nothing is stored and the participant can retry. | Test: `redaction.test.ts` |
| D4 | Emails, phone numbers, and long ID numbers are removed by pattern even if the model misses them. | Test: `redaction.test.ts` |
| D5 | Submission dates are stored to the day. Transcripts are deleted after the campaign's retention period. | Code review: `submit`, `cleanup` |

### Abuse and access

| ID | Requirement | Verified by |
|---|---|---|
| S1 | Starting a conversation requires a passed bot check, and is limited per network and per campaign per day. | Manual; code review |
| S2 | A submission requires a signed, unexpired, single-use token bound to its campaign. | Test: `security.test.ts` |
| S3 | The AI service key never reaches the browser. | Code review: `startSession` |
| S4 | The review page requires the shared password. Wrong attempts are limited. A forged or stale sign-in is rejected. Changing the password signs everyone out. | Test: `security.test.ts` |
| S5 | Exported spreadsheets cannot carry formulas. Malformed transcript input is dropped. | Test: `format.test.ts` |

### Review

| ID | Requirement | Verified by |
|---|---|---|
| R1 | Each response is coded into the campaign's fixed themes with a summary and supporting quotes. | Manual |
| R2 | Reviewers can generate a synthesis across responses, export CSV, and delete a response. | Manual |
| R3 | The review page states how results are produced and warns when there are fewer than five responses. | Manual |

## Out of scope

- Identifying or following up with individual participants
- Urgent reports or formal complaints
- Storing or replaying audio
- Sign-in for participants

## Open questions

- Data classification of de-identified feedback under the St. Thomas Data Classification Policy
- Hosting on the university's AWS platform (see `docs/DECISIONS.md`, decision 2)
- Per-person reviewer sign-in in place of the shared password
