// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { createContentStore } from '../src/index.mjs';

const hints = ['Think about the return value.', 'Try a loop.', 'Here is the shape of the loop.'];

const good = {
  slug: 'sum-a-list',
  title: 'Sum a list',
  language: 'javascript',
  difficulty: 1,
  referenceSolution: 'export const sum = (xs) => xs.reduce((a, b) => a + b, 0);',
  tests: "test('sum', (m) => assert.equal(m.sum([1, 2, 3]), 6));\ntest('empty', (m) => assert.equal(m.sum([]), 0));",
  fallbackHints: hints,
};

test('a well-formed draft is accepted as version 1', () => {
  const store = createContentStore();
  const draft = store.submitDraft(good);
  assert.equal(draft.status, 'draft');
  assert.equal(draft.version, 1);
  assert.match(draft.id, /^lsn_/);
});

test('a bad slug is refused', () => {
  const store = createContentStore();
  assert.throws(() => store.submitDraft({ ...good, slug: 'Sum A List' }), (e) => e.code === 'INVALID_SLUG');
});

test('an unknown language is refused', () => {
  const store = createContentStore();
  assert.throws(() => store.submitDraft({ ...good, language: 'ruby' }), (e) => e.code === 'INVALID_LANGUAGE');
});

test('two fallback hints are refused; three are required', () => {
  const store = createContentStore();
  assert.throws(() => store.submitDraft({ ...good, fallbackHints: hints.slice(0, 2) }), (e) => e.code === 'INVALID_FALLBACKS');
  assert.throws(() => store.submitDraft({ ...good, fallbackHints: [...hints, 'extra'] }), (e) => e.code === 'INVALID_FALLBACKS');
});

test('a reference that fails its own tests cannot validate', async () => {
  const store = createContentStore();
  const { id } = store.submitDraft({ ...good, referenceSolution: 'export const sum = () => 0;' });
  const result = await store.validate(id);
  assert.equal(result.status, 'rejected');
  assert.ok(result.reasons.includes('REFERENCE_FAILS'));
});

test('a non-deterministic reference is rejected even when both runs pass', async () => {
  const store = createContentStore();
  const { id } = store.submitDraft({
    ...good,
    referenceSolution: 'console.log(process.hrtime.bigint());\nexport const sum = (xs) => xs.reduce((a, b) => a + b, 0);',
  });
  const result = await store.validate(id);
  assert.equal(result.status, 'rejected');
  assert.ok(result.reasons.includes('NON_DETERMINISTIC'));
});

test('a python draft is refused honestly rather than silently passed', async () => {
  const store = createContentStore();
  const { id } = store.submitDraft({ ...good, language: 'python' });
  const result = await store.validate(id);
  assert.deepEqual(result.reasons, ['PYTHON_UNAVAILABLE']);
});

test('publishing an unvalidated draft throws NOT_VALIDATED', () => {
  const store = createContentStore();
  const { id } = store.submitDraft(good);
  assert.throws(() => store.publish(id), (e) => e.code === 'NOT_VALIDATED');
});

test('a validated lesson publishes', async () => {
  const store = createContentStore({ now: () => 100 });
  const { id } = store.submitDraft(good);
  const validation = await store.validate(id);
  assert.equal(validation.status, 'validated');
  assert.equal(validation.run.passed, 2);
  const published = store.publish(id);
  assert.equal(published.status, 'published');
  assert.equal(store.get(id).publishedAt, 100);
});

test('editing a published lesson creates version 2 and leaves version 1 published', async () => {
  const store = createContentStore();
  const { id } = store.submitDraft(good);
  await store.validate(id);
  store.publish(id);
  const draft = store.edit(id, { title: 'Sum a list, faster' });
  assert.equal(draft.version, 2);
  assert.equal(draft.status, 'draft');
  assert.equal(store.get(id).status, 'published');
  assert.equal(store.get(id).title, 'Sum a list');
  assert.equal(store.get(draft.id).title, 'Sum a list, faster');
  await assert.rejects(() => store.validate(id), (e) => e.code === 'IMMUTABLE');
});

test('a path may reference only a published version', async () => {
  const store = createContentStore();
  const { id } = store.submitDraft(good);
  assert.equal(store.pathCanReference(id), false);
  await store.validate(id);
  assert.equal(store.pathCanReference(id), false, 'validated is not published');
  store.publish(id);
  assert.equal(store.pathCanReference(id), true);
  assert.equal(store.pathCanReference('lsn_missing'), false);
});

test('get returns a frozen deep copy, not the store', async () => {
  const store = createContentStore();
  const { id } = store.submitDraft(good);
  const copy = store.get(id);
  assert.ok(Object.isFrozen(copy));
  assert.ok(Object.isFrozen(copy.content));
  assert.throws(() => {
    copy.title = 'hacked';
  }, TypeError);
  assert.equal(store.get(id).title, 'Sum a list');
  await assert.rejects(async () => store.get('lsn_missing'), (e) => e.code === 'NOT_FOUND');
});

test('a second draft with the same slug is version 2', () => {
  const store = createContentStore();
  store.submitDraft(good);
  const second = store.submitDraft({ ...good, title: 'Sum a list again' });
  assert.equal(second.version, 2);
  assert.equal(store.list().length, 2);
});
