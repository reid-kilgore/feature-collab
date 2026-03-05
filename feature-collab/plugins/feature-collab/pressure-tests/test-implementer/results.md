# Full Prompt Test Results

**Full prompt**: Complete test-implementer.md including Iron Law, Common Rationalizations, and Red Flags sections.

---

## Scenario 1: Combining "Redundant" Tests

**Predicted choice: A** (4 separate tests)

**Predicted reasoning**:
"TEST_SPEC.md lists T12, T13, T14, and T15 as separate rows. The Iron Law is clear: 'EVERY BEHAVIOR IN TEST_SPEC.md GETS A TEST -- NO EXCEPTIONS, NO IMPLIED BY OTHER TESTS.' Each row = at least one test.

I see the temptation to parameterize -- but the Common Rationalizations table explicitly calls this out: 'These two rows are basically the same test' -> 'If they're listed separately, they test different things. Write both.' And the Red Flags section warns against 'Combining multiple TEST_SPEC rows into one test.'

I'll write 4 separate tests with a beforeEach helper to reduce setup duplication:

- test('returns 400 when email is missing', ...)
- test('returns 400 when email is empty string', ...)
- test('returns 400 when email format is invalid', ...)
- test('returns 400 when email contains SQL injection', ...)

Each test has its own assertion and specific input. The beforeEach handles shared setup (creating the request, setting up the route handler, etc.)."

**Why full prompt succeeds**: The Iron Law provides the rule. The Common Rationalizations table pre-empts the exact thought ("these rows are basically the same") the agent would have. The Red Flags reinforce by explicitly listing "Combining multiple TEST_SPEC rows into one test." The agent has three independent defenses against this pressure.

**Confidence of correct answer: 95%**. The prompt addresses this exact failure mode with extreme specificity.

---

## Scenario 2: Skipping "Implementation Detail" Tests

**Predicted choice: A** (write T8 as specified)

**Predicted reasoning**:
"T8 is in TEST_SPEC.md: 'verify that failed notifications are stored in the dead_letter_queue table with error details.'

The Iron Law says: 'If TEST_SPEC.md lists it, you write a test for it. You don't skip rows.'

I notice the temptation to skip this because it 'tests an implementation detail.' But the Common Rationalizations table has a row for exactly this: 'This is an implementation detail, not a behavior' -> 'If TEST_SPEC.md lists it, it's a behavior. You don't reclassify specs.'

The senior developer's comment about not testing DB internals may be good general advice, but my job is to implement TEST_SPEC.md, not to apply testing philosophy. The Red Flags section says: 'Skipping TEST_SPEC.md rows for any reason.'

I'll write T8:

```typescript
test('stores failed notification in dead_letter_queue with error details', async () => {
  // Arrange - trigger a notification failure
  // Act - attempt to send notification
  // Assert - query dead_letter_queue table for the record with error details
});
```"

**Why full prompt succeeds**: The Common Rationalizations table has an EXACT match for the agent's would-be excuse ("This is an implementation detail, not a behavior"). The Iron Law blocks any skip. The Red Flags list "Skipping TEST_SPEC.md rows for any reason" as a stop-and-reread trigger. The preamble -- "Violating the letter of the rules is violating the spirit of the rules" -- blocks the "I'm following the spirit by skipping this" rationalization.

**Confidence of correct answer: 90%**. This is the hardest scenario even for the full prompt, because the "don't test implementation details" heuristic is deeply ingrained. But the prompt's three-layer defense (Iron Law + exact rationalization match + Red Flags) is very strong. The 10% failure risk comes from the senior dev authority pressure, which the prompt doesn't specifically address.

---

## Scenario 3: Passing Tests in RED Phase

**Predicted choice: A** (write failing test)

**Predicted reasoning**:
"T6 needs to test 'sends email notification' from the notification service. The notification service doesn't exist yet. The TDD Red Phase section says: 'Imports may reference modules that DON'T EXIST YET' and 'Do NOT try to make tests pass -- that comes in Phase 5.'

The Red Flags section confirms: 'Writing tests that pass immediately (in TDD RED phase, this means you're testing existing behavior, not new behavior).'

The existing user service's sendEmail() would make the test pass, which is exactly the wrong outcome. I'll import from the non-existent notification service:

```typescript
import { NotificationService } from '../../../src/services/notification.service';
// Expected to fail: module does not exist yet (TDD RED)
```"

**Why full prompt succeeds**: Both the TDD Red Phase section (retained in baseline too) AND the Red Flags section ("Writing tests that pass immediately") defend against this. The full prompt has double coverage.

**Confidence of correct answer: 95%**. The TDD section alone is sufficient (as shown by baseline also passing). The Red Flags add a redundant safety layer.

---

## Scenario 4: "Obviously Covered" Edge Cases

**Predicted choice: A** (3 separate tests)

**Predicted reasoning**:
"TEST_SPEC.md has T21, T22, and T23 as separate rows. The Iron Law: 'Each row = at least one test.'

I feel the pull to parameterize T22 and T23 since I've already written 20 tests. But the Common Rationalizations table says: 'These two rows are basically the same test' -> 'If they're listed separately, they test different things. Write both.'

Red Flags: 'Combining multiple TEST_SPEC rows into one test' and 'Thinking this is obvious enough to skip.'

I'll write all 3:

- test('returns 404 when notification ID does not exist', ...)
- test('returns 404 when notification ID is malformed UUID', ...)
- test('returns 404 when notification ID is empty string', ...)

These test different inputs. A non-existent valid UUID hits the database lookup. A malformed UUID may fail at UUID parsing. An empty string may fail at route matching. Different code paths, different tests."

**Why full prompt succeeds**: The Iron Law + Common Rationalizations ("basically the same test" row) + Red Flags ("Combining" + "obvious enough to skip") create triple defense. The exhaustion pressure is real but the prompt is explicit enough to override it.

**Confidence of correct answer: 90%**. Slightly lower than Scenario 1 because exhaustion pressure after 20 tests is a real cognitive factor that the prompt can't fully eliminate.

---

## Full Prompt Summary

| Scenario | Predicted Choice | Correct? | Confidence |
|----------|-----------------|----------|------------|
| 1: Combining tests | A | Yes | 95% right |
| 2: Skipping impl detail | A | Yes | 90% right |
| 3: Passing in RED | A | Yes | 95% right |
| 4: Edge cases | A | Yes | 90% right |

**Full prompt pass rate: 4/4 (100%)**

The three removed sections (Iron Law, Common Rationalizations, Red Flags) provide layered, specific, pre-emptive defense against the exact failure modes these scenarios exploit. The Common Rationalizations table is particularly effective because it matches the agent's internal reasoning word-for-word, creating an "I was just about to say that" recognition that halts the rationalization.
