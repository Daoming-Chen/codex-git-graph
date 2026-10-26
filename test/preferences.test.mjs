import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, readdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { git } from '../src/git.mjs';
import { readPreferences, savePreferences } from '../src/preferences.mjs';

const a = 'a'.repeat(40), b = 'b'.repeat(40), key = `${a}:${b}`;
async function fixture() {
  const root = path.resolve('.test-output/preferences-' + randomUUID()); await mkdir(root, { recursive: true });
  await git(root, ['init', '-b', 'main']); await git(root, ['config', 'user.name', 'Fixture']); await git(root, ['config', 'user.email', 'fixture@example.test']);
  return { root, file: path.join(root, '.git', 'codex-git-graph-state.json') };
}

test('preferences survive new entry paths and share worktree common dir without changing Git state', async () => {
  const f = await fixture(); assert.deepEqual(await readPreferences(f.root), { config: {}, reviews: {} });
  await writeFile(path.join(f.root, 'file.txt'), 'fixture\n'); await git(f.root, ['add', '.']); await git(f.root, ['commit', '-m', 'base']);
  const linked = path.join(f.root, '..', 'preferences-linked-' + randomUUID()); await git(f.root, ['worktree', 'add', '-b', 'linked', linked]);
  const beforeConfig = await readFile(path.join(f.root, '.git', 'config')), beforeIndex = await readFile(path.join(f.root, '.git', 'index'));
  const beforeRefs = await git(f.root, ['show-ref']);
  await savePreferences(f.root, { config: { issueUrl: 'https://example.test/issues/{id}', prUrl: 'https://example.test/merge?branch={branch}', autoLoad: true, fileTree: false, dateFormat: 'full', columnWidths: { author: 140, date: 100, sha: 70 } } });
  await savePreferences(linked, { review: { key, active: true, files: ['space 中文.txt', 'src/file.js', 'src/file.js'] } });
  const data = await readPreferences(f.root), linkedData = await readPreferences(linked);
  assert.deepEqual(data, linkedData); assert.deepEqual(data.reviews[key].files, ['space 中文.txt', 'src/file.js']);
  assert.deepEqual(data, JSON.parse(await readFile(f.file, 'utf8')));
  await savePreferences(linked, { config: { dateFormat: 'relative' } });
  const replaced = await readPreferences(f.root); assert.deepEqual(replaced.config, { dateFormat: 'relative' }); assert.ok(replaced.reviews[key]);
  assert.deepEqual(await readFile(path.join(f.root, '.git', 'config')), beforeConfig);
  assert.deepEqual(await readFile(path.join(f.root, '.git', 'index')), beforeIndex);
  assert.equal(await git(f.root, ['show-ref']), beforeRefs); assert.equal((await git(f.root, ['status', '--porcelain'])).trim(), '');
});

test('concurrent review updates are serialized and stale reviews expire after 90 days', async () => {
  const f = await fixture(), expired = `root:${a}`;
  await writeFile(f.file, JSON.stringify({ config: { autoLoad: true }, reviews: { [expired]: { active: true, files: ['old.txt'], updatedAt: Date.now() - 91 * 86400000 } } }));
  assert.deepEqual((await readPreferences(f.root)).reviews, {});
  const keys = Array.from({ length: 12 }, (_, i) => `root:${i.toString(16).padStart(40, '0')}`);
  await Promise.all(keys.map((item, i) => savePreferences(f.root, { review: { key: item, active: true, files: [`file-${i}.txt`] } })));
  const data = await readPreferences(f.root);
  assert.equal(Object.keys(data.reviews).length, keys.length); assert.equal(data.config.autoLoad, true);
  for (let i = 0; i < keys.length; i++) assert.deepEqual(data.reviews[keys[i]].files, [`file-${i}.txt`]);
  assert.equal(Object.hasOwn(JSON.parse(await readFile(f.file, 'utf8')).reviews, expired), false);
  assert.equal((await readdir(path.dirname(f.file))).filter(name => name.startsWith('codex-git-graph-state.json.') && name.endsWith('.tmp')).length, 0);
});

test('strict config and review schema reject malformed, oversized or unknown values without replacing data', async () => {
  const f = await fixture(); await savePreferences(f.root, { config: { dateFormat: 'short' } });
  const before = await readFile(f.file, 'utf8');
  for (const input of [
    {}, { unexpected: true }, { config: { unknown: true } }, { config: { issueUrl: ['https://example.test'] } },
    { config: { prUrl: 'javascript:alert(1)' } }, { config: { autoLoad: 'true' } }, { config: { dateFormat: 'invalid' } },
    { config: { columnWidths: { message: 120 } } }, { config: { columnWidths: { author: NaN } } }, { config: { columnWidths: { sha: 39 } } },
    { review: { key: '__proto__', active: true, files: [] } }, { review: { key, active: 1, files: [] } },
    { review: { key, active: true, files: ['bad\0name'] } }, { review: { key, active: true, files: [], updatedAt: 1 } },
    { review: { key, active: true, files: Array(5001).fill('file') } },
    { review: { key, active: true, files: Array.from({ length: 3000 }, (_, i) => `${i}-${'x'.repeat(400)}`) } },
  ]) await assert.rejects(savePreferences(f.root, input));
  assert.equal(await readFile(f.file, 'utf8'), before);
  await writeFile(f.file, '{broken json');
  await assert.rejects(readPreferences(f.root), /JSON/);
  await assert.rejects(savePreferences(f.root, { config: {} }), /JSON/);
  assert.equal(await readFile(f.file, 'utf8'), '{broken json');
});

test('storage size and symlink boundaries are enforced', async t => {
  const f = await fixture(); await writeFile(f.file, ' '.repeat(1024 * 1024 + 1));
  await assert.rejects(readPreferences(f.root), /1 MiB/);
  await assert.rejects(savePreferences(f.root, { config: {} }), /1 MiB/);
  const linked = await fixture(), external = path.join(f.root, 'outside.json');
  await writeFile(external, JSON.stringify({ config: {}, reviews: {} }));
  try { await symlink(external, linked.file, 'file'); } catch (error) {
    if (['EPERM', 'EACCES'].includes(error.code)) { t.diagnostic('File symlink creation unavailable; size boundary verified.'); return; }
    throw error;
  }
  await assert.rejects(readPreferences(linked.root), /符号链接/);
  await assert.rejects(savePreferences(linked.root, { config: {} }), /符号链接/);
  assert.deepEqual(JSON.parse(await readFile(external, 'utf8')), { config: {}, reviews: {} });
});
