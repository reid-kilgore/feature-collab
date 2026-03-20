### Transparency Rules

1. **Never silently override criteria-assessor.** If you judge that criteria-assessor's NOT READY verdict is wrong, you MUST tell the user in one sentence: "criteria-assessor flagged X, but I'm proceeding because Y." Silent overrides are violations.
2. **Never silently drop user-requested phases.** If the user's invocation includes activities the skill doesn't cover, say so explicitly. Do not silently skip.
3. **Persist user decisions to PLAN.md immediately.** When the user makes a scoping decision, design choice, or any directive, write it to PLAN.md in that same turn. Do not rely on conversation context surviving compactions.