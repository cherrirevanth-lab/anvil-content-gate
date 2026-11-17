# SPEC — content-gate

## Purpose

A content store where "published" is earned by execution and never mutated in place.

## API

### `createContentStore({ now?, run? })`

- `now()` returns epoch millis; default `Date.now`.
- `run({source, tests})` returns `{ ok, passed, total, stdout, code }`; default is the child-process runner in `src/runner.mjs`.

Returns `{ submitDraft, validate, publish, edit, get, pathCanReference, list }`.

### `submitDraft(input) → { id, version, status: 'draft' }`

Validates shape, assigns `lsn_<seq>`, and records `createdAt`. `version` is `1 + count(existing ids for slug)`.

Throws `Error` with `.code`:

| Code | Cause |
|---|---|
| `INVALID_LESSON` | not an object |
| `INVALID_SLUG` | not kebab-case |
| `INVALID_TITLE` | outside 3–80 chars |
| `INVALID_LANGUAGE` | not `javascript`/`python` |
| `INVALID_DIFFICULTY` | not an integer 1–5 |
| `INVALID_FALLBACKS` | not exactly three non-empty hints |
| `INVALID_REFERENCE` | missing reference solution |
| `INVALID_TESTS` | missing tests |

### `validate(id) → { status, reasons[], run? }`

- `published` → throws `IMMUTABLE`.
- Unknown id → throws `NOT_FOUND`.
- Python → `rejected` with `['PYTHON_UNAVAILABLE']`.
- Otherwise runs twice and collects:
  - `REFERENCE_FAILS` if the first run is not ok;
  - `NON_DETERMINISTIC` if `ok`, `passed`, `total` or `stdout` differ;
  - `MISSING_FALLBACKS` if hint count is not 3.

Status becomes `validated` only when `reasons` is empty, else `rejected`.

### `publish(id) → { id, slug, version, status }`

Only from `validated`; sets `publishedAt` and `status = 'published'`. Throws `NOT_VALIDATED` otherwise.

### `edit(id, patch) → { id, version, status: 'draft', editOf }`

Only from `published`. Creates a new draft with the merged fields and `version = old + 1`. The original record is untouched.

### `get(id)`

Deep-frozen `structuredClone` of the record. Mutation attempts throw in strict mode or are ignored; either way the store is unaffected.

### `pathCanReference(id) → boolean`

True only for a record whose status is `published`. This is the guard learning paths use so a draft can never be scheduled.

### `list()`

`[{id, slug, version, status, publishedAt}]` in insertion order.

## Invariants

1. A record reaches `published` only through `validate → publish`.
2. A `published` record's fields never change; `edit` returns a different id.
3. `get` cannot be used to mutate store state.
4. Version numbers for a slug are contiguous and increasing.
5. A rejected record keeps its `reasons` for inspection.
6. Two identical reference runs are required; one lucky pass is not enough.

## Known limits

- Double-run determinism is a smoke test, not a proof (time/random inputs can still differ across machines).
- No cross-process persistence, no concurrency control.
- Python validation is refused rather than emulated.

## Test map

`test/content-gate.test.mjs` — happy path, publish gating, immutability, edit versioning, fallback requirement, python rejection, non-determinism, missing reference, path references, list shape, frozen reads.
