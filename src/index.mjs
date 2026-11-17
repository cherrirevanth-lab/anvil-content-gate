// SPDX-License-Identifier: MIT
/**
 * content-gate - draft -> validated -> published, with no way around the gate.
 *
 * A lesson may only be published after its own reference solution passes its
 * own hidden tests twice with identical output. Published versions are
 * immutable: an edit creates the next draft, and the old version keeps serving
 * the learners who started on it.
 */
import { runReference } from './runner.mjs';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const LANGUAGES = Object.freeze(['javascript', 'python']);

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function createContentStore({ now = () => Date.now(), run = runReference } = {}) {
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  if (typeof run !== 'function') throw new TypeError('run must be a function');

  const records = new Map();
  const bySlug = new Map();
  let seq = 0;

  function structure(input) {
    if (!input || typeof input !== 'object') throw fail('INVALID_LESSON', 'lesson must be an object');
    const { slug, title, language = 'javascript', difficulty = 2, content = {}, referenceSolution, tests, fallbackHints } = input;
    if (typeof slug !== 'string' || !SLUG.test(slug)) throw fail('INVALID_SLUG', 'slug must be kebab-case');
    if (typeof title !== 'string' || title.trim().length < 3 || title.length > 80) throw fail('INVALID_TITLE', 'title must be 3..80 chars');
    if (!LANGUAGES.includes(language)) throw fail('INVALID_LANGUAGE', `language must be one of ${LANGUAGES.join(', ')}`);
    if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) throw fail('INVALID_DIFFICULTY', 'difficulty must be 1..5');
    if (!fallbackHints || !Array.isArray(fallbackHints) || fallbackHints.length !== 3
      || fallbackHints.some((h) => typeof h !== 'string' || h.trim().length === 0)) {
      throw fail('INVALID_FALLBACKS', 'exactly three non-empty fallback hints are required');
    }
    if (typeof referenceSolution !== 'string' || referenceSolution.trim().length === 0) {
      throw fail('INVALID_REFERENCE', 'referenceSolution is required');
    }
    if (typeof tests !== 'string' || tests.trim().length === 0) throw fail('INVALID_TESTS', 'tests are required');
    return { slug, title, language, difficulty, content, referenceSolution, tests, fallbackHints: [...fallbackHints] };
  }

  function submitDraft(input) {
    const lesson = structure(input);
    const version = (bySlug.get(lesson.slug)?.length ?? 0) + 1;
    const id = `lsn_${++seq}`;
    const record = {
      id,
      version,
      status: 'draft',
      createdAt: now(),
      publishedAt: null,
      ...lesson,
    };
    records.set(id, record);
    if (!bySlug.has(lesson.slug)) bySlug.set(lesson.slug, []);
    bySlug.get(lesson.slug).push(id);
    return { id, version, status: 'draft' };
  }

  async function validate(id) {
    const record = records.get(id);
    if (!record) throw fail('NOT_FOUND', `no lesson ${id}`);
    if (record.status === 'published') throw fail('IMMUTABLE', 'published versions are immutable');
    if (record.language === 'python') {
      record.status = 'rejected';
      record.reasons = ['PYTHON_UNAVAILABLE'];
      record.run = null;
      return { status: 'rejected', reasons: ['PYTHON_UNAVAILABLE'] };
    }

    const reasons = [];
    const first = await run({ source: record.referenceSolution, tests: record.tests });
    const second = await run({ source: record.referenceSolution, tests: record.tests });
    if (!first.ok) reasons.push('REFERENCE_FAILS');
    if (first.ok !== second.ok || first.passed !== second.passed || first.total !== second.total
      || first.stdout !== second.stdout) {
      reasons.push('NON_DETERMINISTIC');
    }
    if (record.fallbackHints.length !== 3) reasons.push('MISSING_FALLBACKS');

    record.status = reasons.length === 0 ? 'validated' : 'rejected';
    record.reasons = reasons;
    record.run = { passed: first.passed, total: first.total, code: first.code };
    return { status: record.status, reasons, run: record.run };
  }

  function publish(id) {
    const record = records.get(id);
    if (!record) throw fail('NOT_FOUND', `no lesson ${id}`);
    if (record.status !== 'validated') throw fail('NOT_VALIDATED', `lesson ${id} is ${record.status}`);
    record.status = 'published';
    record.publishedAt = now();
    return { id, slug: record.slug, version: record.version, status: 'published' };
  }

  function edit(id, patch = {}) {
    const record = records.get(id);
    if (!record) throw fail('NOT_FOUND', `no lesson ${id}`);
    if (record.status !== 'published') throw fail('NOT_PUBLISHED', 'only published versions are edited through this path');
    const draft = submitDraft({ ...record, ...patch });
    const created = records.get(draft.id);
    created.version = record.version + 1;
    created.editOf = id;
    return { id: created.id, version: created.version, status: 'draft', editOf: id };
  }

  function get(id) {
    const record = records.get(id);
    if (!record) throw fail('NOT_FOUND', `no lesson ${id}`);
    return deepFreeze(structuredClone(record));
  }

  function pathCanReference(id) {
    const record = records.get(id);
    return Boolean(record) && record.status === 'published';
  }

  function list() {
    return [...records.values()].map((r) => ({
      id: r.id,
      slug: r.slug,
      version: r.version,
      status: r.status,
      publishedAt: r.publishedAt,
    }));
  }

  return { submitDraft, validate, publish, edit, get, pathCanReference, list };
}
