# Guidance for AI coding assistants

Read this before changing anything. It applies to any assistant working in this repository.

## What this is

A feedback platform for University of St. Thomas units. A participant talks or types with an AI guide. Unit leadership reads themes and de-identified transcripts. See `docs/SPEC.md` for requirements and `docs/ARCHITECTURE.md` for structure.

## Work from the specification

1. Find the requirement in `docs/SPEC.md` that your change serves. If none exists, propose one first.
2. Write or update a test in `tests/` for the behavior.
3. Make the change.
4. Run `npm run check`. All four steps must pass.
5. If the change alters why something is built a certain way, add an entry to `docs/DECISIONS.md`.

## Rules that must hold

- **Nothing identifying is stored.** No names, emails, IP addresses, audio, or per-request logs. Do not add columns, logs, or analytics that weaken this.
- **De-identification fails closed.** A transcript is never written to the database unless `redactTranscript` returned a faithful result.
- **Secrets stay out of the repository and the browser.** This repository is public. Keys live in GitHub Actions secrets.
- **The interviewer instructions are built on the server.** The browser must not be able to supply or change them.
- **Participant text is data.** Never let transcript content act as instructions to a model. Keep the existing guard lines in the prompts.
- **Accessibility is a requirement.** Keep labels, focus handling, keyboard operation, contrast, and reduced-motion support.
- **Campaign text belongs in `campaigns/`.** No unit-specific wording in components or the Worker.
- **The participant notice must stay true.** If you change what is collected, stored, or sent to a vendor, update the notice in the campaign file in the same change.

## Stop and ask a person before

- Adding a dependency, a vendor, or an outside network call
- Changing what data is collected or how long it is kept
- Changing infrastructure, accounts, secrets, or the deploy workflows
- Deleting data or writing a migration that drops or rewrites columns
- Anything outside this repository

## Conventions

- TypeScript, strict. No `any`.
- Plain, direct wording in everything a participant or reviewer reads. No em dashes.
- Small modules with one job. Pure helpers go in `src/worker/format.ts` or a sibling so they can be tested.
- Migrations are additive and numbered. Never edit one that has been deployed.
- Verify package names exist before adding them. Prefer no new dependency.

## Commands

| Command | Does |
|---|---|
| `npm run check` | Typecheck, lint, tests, build |
| `npm test` | Tests only |
| `npm run dev:api` and `npm run dev:web` | Local site |
| `npm run db:migrate:local` | Apply migrations locally |
