// SPDX-License-Identifier: MIT
// Minimal reference-solution runner. Same shape as a grading harness: the test
// source is an input to a child process and never part of the result.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PRELUDE = `import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
globalThis.assert = assert;
const __tests = [];
globalThis.test = (name, fn) => __tests.push({ name: String(name), fn });
const __out = process.env.ANVIL_RESULT;
let __mod = null;
let __fatal = null;
try { __mod = await import('./reference.mjs'); }
catch (error) { __fatal = 'load error: ' + (error && error.name ? error.name : 'Error'); }
`;

const EPILOGUE = `
const __results = [];
if (!__fatal && __tests.length === 0) __fatal = 'no tests registered';
if (!__fatal) {
  for (const entry of __tests) {
    try { await entry.fn(__mod); __results.push({ name: entry.name, ok: true }); }
    catch { __results.push({ name: entry.name, ok: false }); }
  }
}
writeFileSync(__out, JSON.stringify({ fatal: __fatal, results: __results }));
process.exit(0);
`;

export async function runReference({ source, tests, timeoutMs = 3_000 }) {
  const dir = await mkdtemp(path.join(tmpdir(), 'anvil-content-'));
  const resultPath = path.join(dir, 'result.json');
  try {
    await writeFile(path.join(dir, 'reference.mjs'), source, 'utf8');
    await writeFile(path.join(dir, 'harness.mjs'), PRELUDE + tests + EPILOGUE, 'utf8');
    const child = spawn(process.execPath, ['--max-old-space-size=192', 'harness.mjs'], {
      cwd: dir,
      env: { ANVIL_RESULT: resultPath, PATH: process.env.PATH },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = [];
    const err = [];
    child.stdout.on('data', (c) => out.push(c));
    child.stderr.on('data', (c) => err.push(c));
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    const code = await new Promise((resolve) => child.on('close', resolve));
    clearTimeout(timer);

    if (killed) return { ok: false, code: 'TIMEOUT', passed: 0, total: 0, stdout: '', stderr: '' };
    let payload = null;
    try {
      payload = JSON.parse(await readFile(resultPath, 'utf8'));
    } catch {
      payload = null;
    }
    const stdout = Buffer.concat(out).toString('utf8').slice(0, 65_536);
    const stderr = Buffer.concat(err).toString('utf8').slice(0, 4_096);
    if (!payload) return { ok: false, code: `EXIT_${code}`, passed: 0, total: 0, stdout, stderr };
    if (payload.fatal) return { ok: false, code: payload.fatal, passed: 0, total: 0, stdout, stderr };
    const passed = payload.results.filter((r) => r.ok).length;
    return {
      ok: passed === payload.results.length && payload.results.length > 0,
      code: 'OK',
      passed,
      total: payload.results.length,
      stdout,
      stderr,
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
