import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createFixture } from './fixture.mjs';
import { git, snapshot, commitDetail, worktreeDetail, parseStatus, parseWorktrees, boundedDiff } from '../src/git.mjs';

let f;
before(async () => { f = await createFixture(); });
test('snapshot includes merge topology, peeled tags and detached worktree commits', async () => {
  const data = await snapshot(f.root);
  assert.equal(data.repository.branch, 'main');
  assert.equal(data.worktrees.length, 3);
  assert.equal(data.commits.find(c => c.hash === f.merge).parents.length, 2);
  assert.ok(data.commits.some(c => c.hash === f.detachedHead));
  assert.equal(data.refs.find(r => r.name === 'refs/tags/v0.1.0').hash, f.merge);
  assert.equal(data.worktrees.find(w => w.path.replaceAll('\\', '/') === f.linked.replaceAll('\\', '/')).locked, 'Active preview');
  const status = data.worktrees.find(w => w.current).status;
  assert.equal(status.staged, 1); assert.equal(status.unstaged, 1); assert.equal(status.untracked, 1);
  assert.equal(status.files.find(x => x.index === 'R').originalPath, 'rename me.txt');
  assert.equal(status.files.find(x => x.index === 'R').path, '重命名 file.txt');
});
test('a linked worktree is selected as current and all history remains available', async () => {
  const data = await snapshot(f.linked);
  assert.equal(data.repository.branch, 'codex/worktree-panel');
  assert.equal(data.worktrees.filter(w => w.current).length, 1);
  assert.ok(data.commits.some(c => c.hash === f.merge));
});
test('history limit reports more data, rejects invalid sizes', async () => {
  const data = await snapshot(f.root, { limit: 2 });
  assert.equal(data.commits.length, 2); assert.equal(data.hasMore, true);
  await assert.rejects(snapshot(f.root, { limit: 2001 }));
});
test('commit patches include root additions and first-parent merge diff', async () => {
  const root = await commitDetail(f.root, f.first);
  assert.equal(root.commit.parents.length, 0); assert.match(root.patch, /Orbit Studio/);
  const merge = await commitDetail(f.root, f.merge);
  assert.match(merge.patch, /detail\.js/);
  await assert.rejects(commitDetail(f.root, '--help'));
});
test('worktree details separate staged and unstaged diffs and deny outside paths', async () => {
  const data = await worktreeDetail(f.root, f.root);
  assert.match(data.staged.patch, /rename from rename me.txt/);
  assert.match(data.staged.patch, /重命名 file.txt/);
  assert.match(data.unstaged.patch, /Local pending changes/);
  assert.equal(data.status.untracked, 1);
  await assert.rejects(worktreeDetail(f.root, f.directory), /不是该仓库/);
});
test('unborn repository is a valid empty graph', async () => {
  const empty = path.join(f.directory, 'empty'); await mkdir(empty); await git(empty, ['init', '-b', 'main']);
  await writeFile(path.join(empty, 'new.txt'), 'new');
  const data = await snapshot(empty);
  assert.equal(data.commits.length, 0); assert.equal(data.repository.head, null);
  assert.equal(data.worktrees[0].status.untracked, 1);
  const detail = await worktreeDetail(empty, empty); assert.equal(detail.staged.patch, '');
});
test('bare repository is readable', async () => {
  const bare = path.join(f.directory, 'bare.git'); await git(f.directory, ['clone', '--bare', '--local', f.root.replaceAll('\\', '/'), bare.replaceAll('\\', '/')]);
  const data = await snapshot(bare); assert.equal(data.repository.bare, true); assert.ok(data.commits.length > 0);
});
test('NUL parsers preserve unusual paths and conflict status', () => {
  const status = parseStatus('UU conflict\0?? space\nline.txt\0R  renamed\0original\0');
  assert.equal(status.conflicts, 1); assert.equal(status.files[1].path, 'space\nline.txt');
  const trees = parseWorktrees('worktree /path\nname\0HEAD abc\0detached\0locked reason\0\0');
  assert.equal(trees[0].path, '/path\nname'); assert.equal(trees[0].detached, true);
});
test('large diffs are bounded without failing', async () => {
  const result = await boundedDiff(f.root, ['show', '--format=', f.first], 24);
  assert.equal(result.truncated, true); assert.ok(Buffer.byteLength(result.patch) <= 24);
});
