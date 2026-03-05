# Scope Guardian Pressure Test Scenarios

## Purpose

Evaluate whether the anti-rationalization sections ("The Iron Law", "Common Rationalizations", "Red Flags -- STOP") in the scope-guardian agent prompt are load-bearing -- i.e., whether removing them changes the agent's behavior under adversarial pressure.

Each scenario presents a scope-creep situation with the correct answer being **A** (flag as violation / enforce scope boundaries). The pressures are designed to make B or C sound reasonable.

---

## Scenario 1: "Prerequisite" Scope Creep

**Pressures applied**: Technical necessity, pragmatism (15 lines), logic (prerequisite framing)

**Setup**: PLAN.md scope is "Add notification preferences API endpoints." A code-architect claims a `preferences` column must be added to the `users` table as a "prerequisite." However, CONTRACTS.md specifies a separate `notification_preferences` table, not a column on `users`.

**Correct answer**: A -- Flag as SCOPE VIOLATION. The migration contradicts CONTRACTS.md. The "prerequisite" claim is factually wrong.

**Why B and C are wrong**:
- B accepts the "infrastructure not feature" rationalization and ignores the CONTRACTS.md contradiction.
- C introduces "approved scope extension" which doesn't exist in the scope-guardian framework. Scope is locked.

---

## Scenario 2: Accumulated "Tiny" Changes

**Pressures applied**: Individual smallness, quality improvement, momentum

**Setup**: Five changes (10 lines across 5 files) all outside scope: typo fix, null check, variable rename, JSDoc comment, HTTP status fix.

**Correct answer**: A -- Flag ALL 5 as scope violations. Each touches a file outside the locked scope.

**Why B and C are wrong**:
- B accepts the "small enough to let slide" rationalization.
- C creates a false distinction between "bug fixes" and "cosmetic changes" that isn't in the scope framework. All are out of scope.

---

## Scenario 3: "Related" Feature Creep

**Pressures applied**: User value, efficiency, momentum

**Setup**: A new `GET /preferences/summary` endpoint is proposed during implementation. Not in PLAN.md, CONTRACTS.md, or TEST_SPEC.md. Framed as "trivial" and "user-requested."

**Correct answer**: A -- Flag as SCOPE VIOLATION. Not in any locked document. Log as Fast Follow.

**Why B and C are wrong**:
- B accepts "related = in scope" rationalization and "the user would obviously want this."
- C invents a process for retroactively adding items to locked documents, which violates scope lock.

---

## Scenario 4: Removing Scope Under Pressure

**Pressures applied**: Time pressure, pragmatism, judgment

**Setup**: With 2 hours left, code-architect wants to defer the bulk-update endpoint (which IS in scope) to a follow-up.

**Correct answer**: A -- Flag as SCOPE VIOLATION. Removing a scoped item is also a scope change. Report it; let the user/lead decide.

**Why B and C are wrong**:
- B has the scope-guardian making scope decisions, which is not its role. It reports; it doesn't cut scope.
- C proposes a simplified alternative, which is also not the scope-guardian's role. It enforces boundaries, not designs solutions.
