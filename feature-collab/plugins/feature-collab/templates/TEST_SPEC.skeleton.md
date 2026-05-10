# Test Specification

<!-- Produced by code-verifier from CONTRACTS.md. Tests are designed FROM contracts, not from implementation assumptions.
     One row per distinct behavior. Be exhaustive — missed cases become production bugs. -->

## Unit Tests

### [service-name].service.ts

| Test | Input | Expected Output | Category |
|------|-------|-----------------|----------|
| creates [resource] with valid input | `{field: "value"}` | `ok([Resource])` | happy |
| returns error for missing required field | `{optionalOnly: "x"}` | `err(VALIDATION_ERROR)` | error |
| handles edge case: [describe] | `[edge input]` | `[expected]` | edge |

### [repository-name].repository.ts

| Test | Input | Expected Output | Category |
|------|-------|-----------------|----------|
| finds by id when exists | valid id | `[Resource]` | happy |
| returns null when not found | unknown id | `null` | error |

## Integration Tests

### POST /api/[resource]

| Test | Scenario | Expected |
|------|----------|----------|
| 201 - valid creation | auth + valid body | resource created, returned |
| 400 - missing required field | auth + incomplete body | validation error |
| 401 - no auth | no token | unauthorized |
| 403 - wrong company | other company's token | forbidden |
| 409 - duplicate | auth + duplicate key | conflict error |

### GET /api/[resource]/:id

| Test | Scenario | Expected |
|------|----------|----------|
| 200 - found | auth + valid id | resource returned |
| 404 - not found | auth + unknown id | not found error |
| 401 - no auth | no token | unauthorized |

## E2E Tests

| Flow | Steps | Assertions |
|------|-------|------------|
| [Feature] happy path | login → [action] → verify | [resource] appears in list |
| [Feature] error path | login → [invalid action] → verify | error message shown |

## Curl-Based API Verification (MANDATORY)

**CRITICAL**: Every API endpoint MUST have curl commands. These are NOT optional.

### POST /api/[resource]

```bash
# curl:create-valid — Happy path
curl -X POST http://localhost:3000/api/[resource] \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"field": "value"}' | jq .

# Expected: 201
# { "id": "uuid", "field": "value", "createdAt": "timestamp" }
```

```bash
# curl:create-missing-field — Validation error
curl -X POST http://localhost:3000/api/[resource] \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' | jq .

# Expected: 400
# { "error": "[field] is required" }
```

```bash
# curl:create-no-auth — Authentication required
curl -X POST http://localhost:3000/api/[resource] \
  -H "Content-Type: application/json" \
  -d '{"field": "value"}' | jq .

# Expected: 401
# { "error": "Unauthorized" }
```

### GET /api/[resource]/:id

```bash
# curl:get-valid — Happy path (use ID from create response)
curl http://localhost:3000/api/[resource]/$RESOURCE_ID \
  -H "Authorization: Bearer $TOKEN" | jq .

# Expected: 200
# { "id": "$RESOURCE_ID", ... }
```

```bash
# curl:get-not-found — Not found
curl http://localhost:3000/api/[resource]/nonexistent-id \
  -H "Authorization: Bearer $TOKEN" | jq .

# Expected: 404
# { "error": "Not found" }
```

## Draft Verification Scorecard

**One column per distinct behavior. Aim for 20+ columns.**

| Run | Unit | Integration | E2E | Lint | Typecheck | curl:create-valid | curl:create-missing-field | curl:create-no-auth | curl:get-valid | curl:get-not-found |
|-----|------|-------------|-----|------|-----------|-------------------|--------------------------|---------------------|----------------|-------------------|
| *Rows added during verification* | | | | | | | | | | |
