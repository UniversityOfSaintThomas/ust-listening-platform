# Specification

What this system must do, and how to tell that it does. Change this file before changing behavior.

## Purpose

Run listening campaigns for St. Thomas units and projects. Each campaign is a short conversation with an AI guide on one topic, with its own link, questions, and results. The people running it get themes and de-identified transcripts to act on. First campaign: STELAR service feedback.

## Users

| User | Needs |
|---|---|
| Participant (faculty, staff, student) | To give feedback in five to eight minutes, by voice or text, without signing in, knowing what happens to it |
| Reviewer (unit leadership) | To see recurring strengths, friction, and requests, read the responses behind them, and export the data |
| Reviewer for one campaign (project lead) | To see only their campaign's results |
| Admin (the owner) | To create, edit, preview, open, close, and duplicate campaigns from a web page, with no code change |

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
| S6 | Only the admin password (or a named admin) can create or change campaigns. A campaign password opens only that campaign's results, and stops working when it is changed. | Test: `security.test.ts` |
| S4 | The review page requires a password. Wrong attempts are limited. A forged or stale sign-in is rejected. Changing the password signs everyone out. | Test: `security.test.ts` |
| S5 | Exported spreadsheets cannot carry formulas. Malformed transcript input is dropped. | Test: `format.test.ts` |

### Review

| ID | Requirement | Verified by |
|---|---|---|
| R1 | Each response is coded into the campaign's own categories and themes with a summary and supporting quotes. Results coded under an earlier format still display. | Test: `campaigns.test.ts`; Manual |
| R2 | Reviewers can choose a campaign, generate a synthesis, download a spreadsheet (CSV) and the full data (JSON), and delete a response. | Test: `campaigns.test.ts` (CSV); Manual |
| R3 | The review page states how results are produced and warns when there are fewer than five responses. | Manual |

### Campaigns

| ID | Requirement | Verified by |
|---|---|---|
| C1 | An admin can create, edit, duplicate, open, and close a campaign. Its questions, guide background, context choices, analysis categories, themes, page text, colors, and headline size are editable. | Manual; Test: `campaigns.test.ts` (cleaning and checks) |
| C2 | Whatever is saved is cleaned and checked on the server. A campaign missing a purpose, goal, or question, or using a reserved address, is refused. | Test: `campaigns.test.ts` |
| C3 | No campaign can remove or reword the standard data-handling notice or the AI disclosure. | Test: `campaigns.test.ts` |
| C4 | Campaign colors must meet WCAG AA contrast or the save is refused. | Test: `campaigns.test.ts` |
| C5 | A closed campaign accepts conversations only through its private preview link. | Manual; Test: `security.test.ts` (token) |
| C6 | A campaign with responses cannot be deleted. | Manual |
| C7 | An AI draft only fills the form. A person must save it. | Manual |

## Out of scope

- Identifying or following up with individual participants
- Urgent reports or formal complaints
- Storing or replaying audio
- Sign-in for participants

## Open questions

- Data classification of de-identified feedback under the St. Thomas Data Classification Policy
- Hosting on the university's AWS platform (see `docs/DECISIONS.md`, decision 2)
- Per-person reviewer sign-in in place of the shared password
