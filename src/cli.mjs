// SPDX-License-Identifier: MIT
import { createContentStore } from './index.mjs';

const lesson = {
  slug: 'reverse-a-string',
  title: 'Reverse a string',
  language: 'javascript',
  difficulty: 1,
  content: { prose: 'Reverse the characters.' },
  referenceSolution: "export const reverse = (s) => [...s].reverse().join('');",
  tests: "test('reverses', (m) => assert.equal(m.reverse('abc'), 'cba'));",
  fallbackHints: [
    'A string is iterable, character by character.',
    'An array can reverse itself in place.',
    'Split, reverse, join: the shape is three steps.',
  ],
};

const store = createContentStore({ now: () => 1_700_000_000_000 });
const out = [];
const draft = store.submitDraft(lesson);
out.push(`draft ${draft.id} v${draft.version} status=${draft.status}`);
out.push(`published before validate=${store.pathCanReference(draft.id)}`);
const validation = await store.validate(draft.id);
out.push(`validate status=${validation.status} passed=${validation.run?.passed}/${validation.run?.total}`);
const published = store.publish(draft.id);
out.push(`publish status=${published.status} pathCanReference=${store.pathCanReference(draft.id)}`);
const edit = store.edit(draft.id, { title: 'Reverse a string, carefully' });
out.push(`edit v${edit.version} status=${edit.status}; v1 still=${store.get(draft.id).status}`);

const bad = store.submitDraft({ ...lesson, slug: 'bad-reference', referenceSolution: 'export const reverse = () => "";' });
const refused = await store.validate(bad.id);
out.push(`bad reference status=${refused.status} reasons=${refused.reasons.join(',')}`);
out.push('GATE ok=true');
process.stdout.write(out.join('\n') + '\n');

const pass =
  draft.status === 'draft' &&
  validation.status === 'validated' &&
  published.status === 'published' &&
  edit.version === 2 &&
  store.get(draft.id).status === 'published' &&
  refused.status === 'rejected' &&
  refused.reasons.includes('REFERENCE_FAILS');
if (!pass) process.stderr.write('content-gate self-check failed\n');
process.exitCode = pass ? 0 : 1;
