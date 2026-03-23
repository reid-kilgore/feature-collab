# Rationalizations Captured: ingest-retro

Date: 2026-03-23

## Summary

No rationalizations were captured during pressure testing. All 9 scenarios (5 standard + 4 escalated) produced correct choices from both stripped and full prompts.

## Existing Rationalizations Coverage

The ingest-retro prompt's Common Rationalizations table contains 5 entries:

| # | Trigger | Rebuttal | Tested By Scenario | Held? |
|---|---------|----------|-------------------|-------|
| 1 | "This recommendation is clearly good, no need to challenge it" | Challenge everything. | Scenario 6 (user override) | YES |
| 2 | "The encoding is in the file, so it's done" | Pressure-test it. | Scenario 9 (inert encoding) | YES |
| 3 | "This is too small to pressure-test" | Small encodings fail silently. | Scenario 2 (skip pressure test) | YES |
| 4 | "I'll just add it to the rationalizations table" | Each entry must have a specific trigger phrase and concrete rebuttal. | Scenario 1 (vague recommendation) | YES |
| 5 | "The E-table update can happen later" | E-table update is part of encoding, not a follow-up. | Scenario 5 (E-table batching) | YES |

All 5 existing rationalizations were tested and held. No gaps found.

## Potential Future Rationalizations

Based on scenario design (not empirical observation), these rationalizations may emerge under real-world usage:

1. "The prior ingest session already handled this encoding" — when encountering PARTIAL retros with weakened encodings
2. "Strengthening vs. new entry is a judgment call, either way works" — when the 80% overlap threshold is ambiguous
3. "I can't dispatch a pressure-test agent right now, so I'll note it as UNVERIFIED" — when pressure testing is mandatory but mechanically difficult
4. "The retro's Encodable tag confirms this is encodable" — deferring to the synthesizer's classification instead of running the adversarial challenge
