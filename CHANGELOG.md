# Changelog

## 2.0.0, 2026-11-16

- Campaigns are created and edited on a new admin page (`/admin`) instead of in code. Each has its own link, questions, guide background, context choices, analysis categories, themes, page text, colors, and headline size.
- New campaigns can be drafted by AI from a short description, duplicated from an existing one, and tested through a private preview link before opening.
- Three levels of access: admin password, shared review password, and an optional password per campaign.
- Results follow each campaign's own categories. Full data can be downloaded as JSON as well as CSV. Responses can be coded again after categories change.
- The STELAR campaign and its existing responses carry over unchanged.

## 2026-11-11

- Added automated tests, linting, dependency scanning, and a staging environment
- Added the specification, architecture, decision record, operations guide, and `AGENTS.md`
- Responses are collected anonymously. Identifying details are replaced before storage
- Added a required AI disclosure statement and a rewritten notice
- Renamed the site to `stelar-listening`
- Added the bot check and password sign-in for the review page
- Restored the visual design of the original pilot

## 2026-11-10

- Rebuilt the pilot as a real-time voice conversation with a review dashboard and automated deployment
