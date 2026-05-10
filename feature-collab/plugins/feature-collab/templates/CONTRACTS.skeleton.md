# Feature Contracts

<!-- Contracts define the interface. Architecture serves the contracts. Tests verify the contracts.
     Fill in every section that applies. Remove or stub sections that don't apply. -->

## API Contracts

### New Endpoints

| Method | Path | Auth | Input | Output |
|--------|------|------|-------|--------|
| POST | /api/[resource] | Required | `CreateInput` | `ResourceResponse` |
| GET | /api/[resource]/:id | Required | — | `ResourceResponse` |

### Modified Endpoints

| Route | Change | Backward compatible? |
|-------|--------|---------------------|
| GET /api/[resource] | Adds `newField` to response | Yes — additive |

## Data Contracts

### New Types

```typescript
interface [NewType] {
  id: string;
  // required fields...
  optionalField?: string; // NEW
}
```

### Modified Types

```typescript
interface [ExistingType] {
  // existing fields unchanged...
  newField: string; // NEW — added by this feature
}
```

### Database schema changes (if any)

```sql
-- Migration: add column / create table / etc.
ALTER TABLE [table] ADD COLUMN [column] [type] NOT NULL DEFAULT '';
```

## Behavioral Contracts

Function signatures for new and modified service/repository functions.

### New Functions

```typescript
// [service-file].ts
function [functionName](
  input: [InputType],
  deps: { [repo]: [RepoType] }
): Promise<Result<[OutputType], [ErrorType]>>
```

### Modified Functions

| Function | File | Change | Signature delta |
|----------|------|--------|-----------------|
| `[fn]` | `[path]` | Adds [param] | `(a, b) → (a, b, c)` |

## Error Contracts

| Error code | Condition | HTTP status |
|------------|-----------|-------------|
| `VALIDATION_ERROR` | Missing required field | 400 |
| `NOT_FOUND` | Resource doesn't exist | 404 |
| `UNAUTHORIZED` | No auth token | 401 |
| `FORBIDDEN` | Auth token lacks permission | 403 |

## Transaction Requirements

<!-- Flag any function that performs two sequential writes where the second compensates or extends the first.
     Reference existing tx patterns (e.g., txRunner, PrismaClient | Prisma.TransactionClient). -->

- [ ] No transactions required
- [ ] `[functionName]` requires transaction: [reason — e.g., "mutates membership then syncs grants"]
