# Decision record

Why the system is built the way it is. Add an entry when a choice would otherwise have to be rediscovered.

## 1. Speech-to-speech model over a transcribe, think, speak pipeline
**Date:** 2026-11-10. **Status:** accepted.
The first pilot recorded a clip, uploaded it, transcribed it, generated a reply, and played it. Replies took seconds and people were cut off mid-thought. A real-time speech-to-speech session over WebRTC handles turn-taking and interruption natively. Cost: dependence on one vendor's real-time API. The provider is isolated to `startSession` and `src/app/realtime.ts` so it can be replaced.

## 2. Cloudflare Workers and D1 for the pilot, not the university AWS platform
**Date:** 2026-11-11. **Status:** accepted for the pilot, under review.
The owner chose a fast path under accounts he controls. This departs from St. Thomas guidance, which points internal applications to AWS, the Atlantis platform, and CodeCommit. The application logic is plain TypeScript with no Cloudflare-specific code outside `src/worker/index.ts` bindings, so the API can be rebuilt on Lambda and DynamoDB. See the open questions in `docs/SPEC.md`.

## 3. OpenAI for live voice
**Date:** 2026-11-11. **Status:** accepted.
The Claude API has no real-time speech endpoint. Amazon Nova Sonic on Bedrock was the alternative and remains the likely choice if the system moves to AWS.

## 4. Open link with no participant sign-in
**Date:** 2026-11-11. **Status:** accepted.
Sign-in would confirm university membership but reduce candor. The open link is protected by a bot check, per-network and per-campaign limits, a session time cap, and single-use submit tokens.

## 5. Shared password for reviewers
**Date:** 2026-11-11. **Status:** accepted, weaker than the alternative.
The owner asked for the simplest sign-in. A shared password gives no per-person record. Attempt limits, a 12-hour session, and sign-out on password change were added. Cloudflare Access with named reviewers is implemented and can replace it without code changes.

## 6. Anonymous collection with de-identification before storage
**Date:** 2026-11-11. **Status:** accepted.
Names are not collected. A model replaces identifying details with bracketed placeholders, following UK Data Service guidance, and a pattern pass removes emails, phone numbers, and long numbers. The step fails closed: an unfaithful or missing result means nothing is stored. Limit: a person can still be recognized from what they describe. The notice says so.

## 7. Fixed theme list per campaign
**Date:** 2026-11-10. **Status:** accepted.
Free-form themes cannot be counted across responses. Each campaign defines its themes, and the coder must choose from them.

## 8. Built with an AI coding assistant
**Date:** 2026-11-11. **Status:** noted.
The system was written with Claude under the owner's direction, in conversation. This specification, the tests, and this record were written afterward to bring the project in line with the university's spec-driven guidance. Future changes should start from `docs/SPEC.md`.

## 9. Campaigns live in the database and are edited on an admin page
**Date:** 2026-11-16. **Status:** accepted. Replaces "launch a campaign by editing one file".
The owner wants to start new listening campaigns (end of year check-ins, VR/AR interest, other ITS units) without a code change. Campaigns moved from `campaigns/*.ts` to a `campaigns` table holding each one as JSON. `campaigns/stelar.ts` remains as a starter that is copied in once and never overwrites. A campaign's web address is fixed at creation so links and stored responses stay attached. A campaign with responses cannot be deleted, only closed.

## 10. The data-handling notice is fixed, campaign text is free
**Date:** 2026-11-16. **Status:** accepted.
Once anyone with the admin password can write campaign text, a campaign could promise something the system does not do. The six notice lines that describe collection, storage, the AI vendor, and de-identification, and the AI disclosure checkbox, are generated in code and identical for every campaign. A campaign supplies its purpose, who reads the results, and optional extra lines.

## 11. Analysis categories are set per campaign
**Date:** 2026-11-16. **Status:** accepted. Extends decision 7.
Strengths, friction, and requests fit service feedback but not a campaign about plans or interest. Each campaign defines two to four categories and a theme list. Coded points carry a category key. Results saved in the earlier three-list shape are read through `normalizeAnalysis` and `normalizeSynthesis`, so no stored data was rewritten. After categories change, a reviewer can code all responses again.

## 12. Three levels of password access
**Date:** 2026-11-16. **Status:** accepted, same weakness as decision 5.
An admin password creates and edits campaigns and opens all results. The shared review password opens all results. A campaign can have its own password that opens only its results, stored as a keyed hash. One sign-in box accepts any of them. Each session is tied to the password that opened it, so changing a password ends those sessions. Named sign-in through Cloudflare Access still works, and an "admin" list in `REVIEWERS` names people who can manage campaigns.

## 13. AI drafts campaigns, a person publishes them
**Date:** 2026-11-16. **Status:** accepted.
The new-campaign form can draft its fields from a short description. The draft only fills the form. Nothing is saved until the admin reads it and presses Create, and new campaigns start closed with a private preview link for testing the guide before the link is shared.

## 14. Colors are limited to combinations that meet contrast rules
**Date:** 2026-11-16. **Status:** accepted.
A campaign can set its main, button, and highlight colors and its headline size. The server refuses colors that fall below WCAG AA contrast for the text placed on them.

