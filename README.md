# content-gate

`draft → validated → published`, with no path around the gate.

A lesson may only be published after its own reference solution passes its own hidden tests **twice with identical output**. Published versions are immutable: editing creates the next draft, and the old version keeps serving learners who started on it.

## Why

Content pipelines usually trust the author. Then a lesson ships with a broken reference solution, and every learner hits the same wall. This module makes publication conditional on executable evidence, and makes "published" a state you cannot silently mutate.

## Quickstart

```sh
node --test test/        # 13 tests, no dependencies
node src/cli.mjs         # drafts, validates, publishes, edits
node verify.mjs          # tests + CLI smoke, writes evidence.json
```

```js
import { createContentStore } from './src/index.mjs';

const store = createContentStore();
const { id } = store.submitDraft({
  slug: 'sum-a-list',
  title: 'Sum a list',
  referenceSolution: 'export const solve = (xs) => xs.reduce((a, b) => a + b, 0);',
  tests: "test('sum', (m) => assert.equal(m.solve([1,2,3]), 6));",
  fallbackHints: ['Start with 0.', 'Add each item.', 'Check the empty list.'],
});

await store.validate(id);   // { status: 'validated', reasons: [], run: {...} }
store.publish(id);          // { status: 'published', version: 1 }
```

Final CLI line: `GATE ok=true`.

## Lifecycle

```
submitDraft ──► draft ──validate──► validated ──publish──► published
                    │                                        │
                    └────────────► rejected                  └──edit──► next draft
```

- `validate` runs the reference solution twice. Any mismatch in `ok`, `passed`, `total` or `stdout` is `NON_DETERMINISTIC`.
- `publish` refuses anything that is not `validated` (`NOT_VALIDATED`).
- `edit` only accepts a `published` record and produces a new draft with `version + 1` and `editOf`.
- `get` returns a deep-frozen clone, so callers cannot mutate a published version.
- `pathCanReference(id)` is true only for `published` — learning paths cannot point at drafts.

## Validation rules

| Field | Rule |
|---|---|
| `slug` | kebab-case |
| `title` | 3–80 chars |
| `language` | `javascript` or `python` |
| `difficulty` | integer 1–5 |
| `fallbackHints` | exactly 3 non-empty strings |
| `referenceSolution` | non-empty string |
| `tests` | non-empty string |

Python lessons are accepted as drafts but rejected at validation with `PYTHON_UNAVAILABLE`: the reference runner is JavaScript-only, so claiming validation would be a lie.

## Limits

- Store is in-memory; persistence is the caller's concern.
- Determinism is checked by running twice in the same process, not by sandboxing.
- `tests` are trusted input to the runner; this module gates content, it does not isolate it.
- No approval workflow, no reviewer identity, no audit log beyond `reasons`.

## Permissions

No network, no dependencies, no writes. The default runner spawns a child Node process using the same mechanism as `01-grade-engine`. CI requests `contents: read`. See `permission-manifest.json` and `SECURITY.md`.

## License

MIT © 2026 Revan
