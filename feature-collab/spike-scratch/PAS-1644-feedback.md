# Feedback for PAS-1644 Child Session — Integration Tests Required

## Status: BLOCKED — Do Not Merge

The criteria-assessor marked this READY based on 12/12 unit tests passing. That is a false green.

## What Is Missing

The TEST_SPEC.md for PAS-1644 specifies two test categories:

- Unit tests — 12 specified, 12 written. PASS.
- Integration tests — specified, 0 files written.

Zero files in a required test category is not a passing gate. It means the category was skipped, not that it passed. The criteria-assessor should have caught this; it did not, because it only checked whether existing tests were green, not whether all specified categories had coverage.

## What You Must Do

1. Re-read TEST_SPEC.md and identify every integration test scenario listed.
2. Write integration tests for all specified scenarios. These tests exercise the API client against a real (or stubbed) HTTP boundary — they are not the same as unit tests on internal logic.
3. Re-run the full test suite (unit + integration).
4. Re-invoke the criteria-assessor. It must confirm both categories have coverage before marking READY.

## Why This Is Not Optional

Integration tests for an API client are the primary regression surface. Unit tests verify internal logic but cannot catch serialization mismatches, auth header bugs, or endpoint path errors. These are the failure modes most likely to surface in production.

The user approved this based on "tests are green" — they did not have full information. It is the project lead's responsibility to catch this before merge, not the user's.

## Context Preserved

- All 12 unit tests remain valid and should continue to pass.
- Do not modify unit test files unless a bug is found during integration test work.
- If the integration test environment requires a test fixture or a mock HTTP server, set it up. Do not skip scenarios because the setup is inconvenient.

Once integration tests are written and the criteria-assessor confirms both categories are covered, re-post to the project lead for re-review.
