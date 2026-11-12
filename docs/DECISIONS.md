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
