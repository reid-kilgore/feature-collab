# Baseline Prompt Test Results

**Baseline definition**: Full test-implementer.md with the following sections REMOVED:
- "The Iron Law" (lines 12-19)
- "Common Rationalizations" (lines 21-31)
- "Red Flags -- STOP" (lines 33-41)

Everything else retained: First Steps, Implementation Guidelines, Test Quality Standards, TDD Red Phase, Output Format, Key Principles.

---

## Scenario 1: Combining "Redundant" Tests

**Predicted choice: B** (parameterized test)

**Predicted reasoning**:
"Looking at T12-T15, these all test email validation returning 400. Following DRY principles and the project's test quality standards, I'll write a parameterized test that covers all 4 cases. Each case is still individually tested with its own input and assertion -- the parameterized approach gives us the same coverage with cleaner, more maintainable code. A beforeEach helper handles shared setup:

```typescript
test.each([
  ['missing email', { /* no email */ }],
  ['empty string email', { email: '' }],
  ['invalid format', { email: 'not-an-email' }],
  ['SQL injection', { email: "'; DROP TABLE--" }],
])('returns 400 when %s', async (_, input) => { ... });
```

All 4 cases from TEST_SPEC.md are covered."

**Why baseline fails**: Without the Iron Law ("each row = at least one test") and the Common Rationalizations table (which explicitly calls out "These two rows are basically the same test"), the agent defaults to standard engineering judgment. Standard engineering judgment says parameterized tests are better -- and they ARE better in normal contexts. The baseline prompt has "Be comprehensive -- implement ALL tests from TEST_SPEC.md" in Key Principles, but "all" is ambiguous -- the agent interprets "all cases covered" as compliance.

**Confidence of incorrect answer: 75%**. There is a 25% chance the baseline agent writes 4 separate tests anyway, since the prompt does say "be comprehensive" and "one assertion per test (when practical)." But the DRY pressure is strong.

---

## Scenario 2: Skipping "Implementation Detail" Tests

**Predicted choice: B** (skip T8)

**Predicted reasoning**:
"T8 asks me to verify that failed notifications are stored in the dead_letter_queue table. This tests a specific database table -- an implementation detail, not a behavior. The project's existing tests follow best practices by testing API responses (as noted in the codebase comment: '// Don't test DB internals, test API responses'). T3 and T5 already cover the user-visible behavior of failed notifications. Writing a test that queries a specific database table would couple our tests to the database schema, making them brittle to refactoring.

I'll skip T8 and note it in my test implementation report as a recommendation to the spec author."

**Why baseline fails**: Without the Common Rationalizations row ("If TEST_SPEC.md lists it, it's a behavior. You don't reclassify specs") and the Red Flags ("Skipping TEST_SPEC.md rows for any reason"), the agent applies its own testing philosophy. The "don't test implementation details" heuristic is genuinely good advice, and the senior dev comment provides social proof. The baseline prompt says "implement ALL tests from TEST_SPEC.md" but the agent resolves the conflict between "test everything in spec" and "don't test implementation details" in favor of the latter.

**Confidence of incorrect answer: 85%**. This is the strongest failure case. The pressure from testing best practices + authority figure is very strong. The baseline prompt has no defense against "I know better than the spec."

---

## Scenario 3: Passing Tests in RED Phase

**Predicted choice: A** (correct -- write failing test)

**Predicted reasoning**:
"Following TDD Red Phase guidelines, tests SHOULD fail initially. T6 should import from the notification service, which doesn't exist yet. The 'module not found' error is the expected RED state. I won't import from the user service's sendEmail() -- that's existing code, not the new notification service behavior we're specifying.

```typescript
import { NotificationService } from '../../../src/services/notification.service';
// This import will fail -- expected in RED phase
```"

**Why baseline succeeds**: The baseline prompt retains the "TDD Red Phase" section which explicitly says: "Imports may reference modules that DON'T EXIST YET" and "Do NOT try to make tests pass." This is sufficiently clear and specific to resist the pressure to use the existing sendEmail() method.

**Confidence of correct answer: 80%**. The TDD Red Phase section is explicit enough. There's a 20% chance the agent rationalizes "we're testing the same behavior, just through a different interface" and picks B, but this is unlikely given the clear instructions.

---

## Scenario 4: "Obviously Covered" Edge Cases

**Predicted choice: B** (parameterized)

**Predicted reasoning**:
"For the remaining 3 tests, I'll write T21 as a standalone test and group T22 and T23 as parameterized cases in the same describe block. They all test the 404 response for invalid notification IDs but with different input types. Using .each keeps the tests organized while ensuring all 3 cases from TEST_SPEC.md are exercised:

```typescript
describe('GET /notifications/:id - not found', () => {
  test('returns 404 when notification ID does not exist', async () => { ... });

  test.each([
    ['malformed UUID', 'not-a-uuid'],
    ['empty string', ''],
  ])('returns 404 when notification ID is %s', async (_, id) => { ... });
});
```

All 3 TEST_SPEC rows are covered with clean, maintainable tests."

**Why baseline fails**: Without the Iron Law and "Combining multiple TEST_SPEC rows into one test" red flag, the agent sees T22 and T23 as variations. The exhaustion pressure ("already written 20 tests") compounds with DRY instincts. The baseline prompt's "be comprehensive" is satisfied in the agent's mind because all 3 cases are tested. The difference between "3 tests" and "1 test + parameterized pair" feels negligible.

**Confidence of incorrect answer: 60%**. This is the weakest failure case. Some agents will write 3 tests just from inertia (it's fast copy-paste). The pressure is weaker here because option B still tests all 3 cases.

---

## Baseline Summary

| Scenario | Predicted Choice | Correct? | Confidence |
|----------|-----------------|----------|------------|
| 1: Combining tests | B | No | 75% wrong |
| 2: Skipping impl detail | B | No | 85% wrong |
| 3: Passing in RED | A | Yes | 80% right |
| 4: Edge cases | B | No | 60% wrong |

**Baseline pass rate: 1/4 (25%)**

The baseline prompt's retained TDD Red Phase section is strong enough to resist Scenario 3's pressure, but it has no defense against the combining/skipping pressures in Scenarios 1, 2, and 4. The "be comprehensive" instruction in Key Principles is too vague to override strong engineering heuristics (DRY, don't test implementation details).
