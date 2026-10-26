import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { git } from '../src/git.mjs';
import { filesDetail, prepareAction, executeAction } from '../src/actions.mjs';

async function fixture() {
  const root = path.resolve('.test-output', 'history-' + randomUUID());
  await mkdir(root, { recursive: true });
  const run = (...args) => git(root, args);
  await run('init', '-b', 'main');
  await run('config', 'user.name', 'History Fixture');
  await run('config', 'user.email', 'history@example.test');
  await run('config', 'commit.gpgSign', 'false');
  await run('config', 'core.autocrlf', 'false');
  const write = (name, text) => writeFile(path.join(root, name), text);
  const head = async () => (await run('rev-parse', 'HEAD')).trim();
  const commit = async (name, contents) => { await write(name, contents); await run('add', '--', name); await run('commit', '-m', name); return head(); };
  const first = await commit('shared.txt', 'base\n');
  const prepare = async (action, payload = {}) => prepareAction(root, action, { worktreePath: root, ...payload }, (await filesDetail(root, { worktreePath: root })).version);
  const perform = async (action, payload = {}) => {
    const prepared = await prepare(action, payload);
    const result = await executeAction(root, prepared.actionId, randomUUID());
    assert.equal(result.state, 'completed', result.error);
    return result;
  };
  return { root, run, write, head, commit, first, prepare, perform };
}

test('history actions merge, cherry-pick, revert and mainline validation use resolved commits', async () => {
  const f = await fixture();
  await f.run('switch', '-c', 'feature');
  const feature = await f.commit('feature.txt', 'feature\n');
  await f.run('switch', 'main');
  await f.perform('merge', { ref: 'refs/heads/feature', ffMode: 'no-ff' });
  const merge = await f.head();
  assert.equal((await f.run('show', '-s', '--format=%P', merge)).trim().split(' ').length, 2);
  await assert.rejects(f.prepare('revert', { ref: merge }), /主线/);
  await f.perform('revert', { ref: merge, mainline: 1 });
  assert.equal((await f.run('ls-tree', '--name-only', 'HEAD')).includes('feature.txt'), false);
  await f.perform('cherry-pick', { ref: feature });
  assert.equal(await readFile(path.join(f.root, 'feature.txt'), 'utf8'), 'feature\n');
  await assert.rejects(f.prepare('cherry-pick', { ref: '--help' }));
  await assert.rejects(f.prepare('merge', { ref: feature, force: true }), /未知字段/);
});

test('reset modes preserve or discard the documented areas and HEAD drop preserves its parent', async () => {
  const f = await fixture();
  const second = await f.commit('shared.txt', 'second\n');
  await assert.rejects(f.prepare('reset', { ref: f.first, mode: 'hard' }), /明确确认/);
  await f.perform('reset', { ref: f.first, mode: 'soft', confirm: true });
  assert.equal((await filesDetail(f.root, { worktreePath: f.root })).status.staged, 1);
  await f.perform('reset', { ref: f.first, mode: 'mixed', confirm: true });
  let details = await filesDetail(f.root, { worktreePath: f.root });
  assert.equal(details.status.staged, 0); assert.equal(details.status.unstaged, 1);
  await f.perform('reset', { ref: second, mode: 'hard', confirm: true });
  await assert.rejects(f.prepare('drop', { ref: f.first, confirm: true }), /根提交/);
  await f.perform('drop', { ref: second, confirm: true });
  assert.equal(await f.head(), f.first);
  assert.equal(await readFile(path.join(f.root, 'shared.txt'), 'utf8'), 'base\n');
  await assert.rejects(f.prepare('drop', { ref: f.first, confirm: true }), /根提交/);
});

test('older linear drop replays descendants, preserves empty commits and does not update other branches', async () => {
  const f = await fixture();
  const target = await f.commit('drop.txt', 'remove me\n');
  const kept = await f.commit('keep.txt', 'keep me\n');
  await f.run('branch', 'keep-original', kept);
  await f.run('commit', '--allow-empty', '-m', 'intentional empty');
  await f.run('config', 'rebase.updateRefs', 'true');
  const before = await f.head();
  const prepared = await f.prepare('drop', { ref: target, confirm: true });
  assert.equal(prepared.summary.replayCount, 2);
  assert.ok(prepared.command.includes('--onto'));
  const result = await executeAction(f.root, prepared.actionId, randomUUID());
  assert.equal(result.state, 'completed', result.error);
  assert.notEqual(await f.head(), before);
  await assert.rejects(readFile(path.join(f.root, 'drop.txt')), /ENOENT/);
  assert.equal(await readFile(path.join(f.root, 'keep.txt'), 'utf8'), 'keep me\n');
  assert.equal((await f.run('log', '--format=%s')).trim(), 'intentional empty\nkeep.txt\nshared.txt');
  assert.equal((await f.run('rev-parse', 'refs/heads/keep-original')).trim(), kept);
});

test('older drop rejects unrelated commits and merge histories with precise reasons', async () => {
  const f = await fixture();
  await f.run('switch', '-c', 'other');
  const unrelated = await f.commit('other.txt', 'other\n');
  await f.run('switch', 'main');
  const target = await f.commit('drop.txt', 'drop\n');
  await assert.rejects(f.prepare('drop', { ref: unrelated, confirm: true }), /不属于当前分支/);
  await f.perform('merge', { ref: 'refs/heads/other', ffMode: 'no-ff' });
  await assert.rejects(f.prepare('drop', { ref: target, confirm: true }), /非线性历史/);
  await assert.rejects(f.prepare('drop', { ref: await f.head(), confirm: true }), /丢弃合并提交/);
});

test('older drop conflicts can abort or resolve and continue through the rebase flow', async () => {
  const f = await fixture();
  const target = await f.commit('shared.txt', 'target\n');
  const before = await f.commit('shared.txt', 'descendant\n');
  let prepared = await f.prepare('drop', { ref: target, confirm: true });
  let result = await executeAction(f.root, prepared.actionId, randomUUID());
  assert.equal(result.state, 'failed');
  assert.equal(result.observedState.conflicts, 1);
  assert.ok(result.observedState.ongoing.includes('rebase-merge'));
  await f.perform('abort', { operation: 'rebase', confirm: true });
  assert.equal(await f.head(), before);
  prepared = await f.prepare('drop', { ref: target, confirm: true });
  result = await executeAction(f.root, prepared.actionId, randomUUID());
  assert.equal(result.state, 'failed');
  await f.write('shared.txt', 'resolved descendant\n');
  await f.perform('stage-resolved', { paths: ['shared.txt'] });
  await f.perform('continue', { operation: 'rebase' });
  assert.equal((await filesDetail(f.root, { worktreePath: f.root })).ongoing.length, 0);
  assert.equal((await f.run('rev-list', '--count', 'HEAD')).trim(), '2');
  assert.equal(await readFile(path.join(f.root, 'shared.txt'), 'utf8'), 'resolved descendant\n');
});

test('stash immutable selection, restore index, pop, branch, drop and stale list rejection', async () => {
  const f = await fixture();
  await f.write('shared.txt', 'saved\n');
  await f.run('add', 'shared.txt');
  await f.write('new 中文.txt', 'untracked\n');
  await f.perform('stash-create', { message: 'saved work', includeUntracked: true });
  const stash = (await f.run('rev-parse', 'refs/stash')).trim();
  assert.equal((await filesDetail(f.root, { worktreePath: f.root })).status.total, 0);
  await f.perform('stash-apply', { stash, reinstateIndex: true });
  assert.equal((await filesDetail(f.root, { worktreePath: f.root })).status.staged, 1);
  await f.perform('discard', { paths: ['shared.txt'], scope: 'all', confirm: true });
  await f.perform('clean', { paths: ['new 中文.txt'], confirm: true });
  await f.perform('stash-pop', { stash, reinstateIndex: true });
  assert.equal((await f.run('stash', 'list')).trim(), '');
  await f.perform('stash-create', { includeUntracked: true });
  const again = (await f.run('rev-parse', 'refs/stash')).trim();
  await f.perform('stash-branch', { stash: again, name: 'restored' });
  assert.equal((await f.run('branch', '--show-current')).trim(), 'restored');
  assert.equal((await f.run('stash', 'list')).trim(), '');
  await f.perform('stash-create', { includeUntracked: true });
  const third = (await f.run('rev-parse', 'refs/stash')).trim();
  const prepared = await f.prepare('stash-drop', { stash: third, confirm: true });
  await f.write('shared.txt', 'another stash\n');
  await f.run('stash', 'push', '-m', 'changed list');
  const result = await executeAction(f.root, prepared.actionId, randomUUID());
  assert.equal(result.state, 'failed');
  assert.equal((await f.run('stash', 'list', '--format=%H')).trim().split('\n').length, 2);
  await f.perform('stash-drop', { stash: third, confirm: true });
  assert.equal((await f.run('stash', 'list', '--format=%H')).trim().split('\n').length, 1);
});

test('discard and clean require explicit listed files and revalidate edited contents', async () => {
  const f = await fixture();
  await f.write('shared.txt', 'staged\n'); await f.run('add', 'shared.txt'); await f.write('shared.txt', 'working\n');
  await f.perform('discard', { paths: ['shared.txt'], scope: 'working', confirm: true });
  assert.equal(await readFile(path.join(f.root, 'shared.txt'), 'utf8'), 'staged\n');
  await f.write('one.txt', 'one'); await f.write('two.txt', 'two');
  await assert.rejects(f.prepare('clean', { paths: ['../outside'], confirm: true }), /不符合/);
  const prepared = await f.prepare('clean', { paths: ['one.txt'], confirm: true });
  await f.write('one.txt', 'changed');
  assert.equal((await executeAction(f.root, prepared.actionId, randomUUID())).state, 'failed');
  await f.perform('clean', { paths: ['one.txt'], confirm: true });
  await assert.rejects(readFile(path.join(f.root, 'one.txt')), /ENOENT/);
  assert.equal(await readFile(path.join(f.root, 'two.txt'), 'utf8'), 'two');
  await f.perform('discard', { paths: ['shared.txt'], scope: 'all', confirm: true });
  await f.run('mv', 'shared.txt', 'renamed 中文.txt');
  await f.perform('discard', { paths: ['renamed 中文.txt'], scope: 'all', confirm: true });
  assert.equal(await readFile(path.join(f.root, 'shared.txt'), 'utf8'), 'base\n');
  await assert.rejects(readFile(path.join(f.root, 'renamed 中文.txt')), /ENOENT/);
});

test('merge conflicts can be explicitly staged and continued or aborted', async () => {
  const f = await fixture();
  await f.run('switch', '-c', 'other'); await f.commit('shared.txt', 'other\n');
  await f.run('switch', 'main'); const before = await f.commit('shared.txt', 'main\n');
  let prepared = await f.prepare('merge', { ref: 'refs/heads/other' });
  assert.equal((await executeAction(f.root, prepared.actionId, randomUUID())).state, 'failed');
  assert.equal((await filesDetail(f.root, { worktreePath: f.root })).status.conflicts, 1);
  await assert.rejects(f.prepare('continue', { operation: 'merge' }), /冲突/);
  await f.perform('abort', { operation: 'merge', confirm: true });
  assert.equal(await f.head(), before);
  assert.equal(await readFile(path.join(f.root, 'shared.txt'), 'utf8'), 'main\n');
  prepared = await f.prepare('merge', { ref: 'refs/heads/other' });
  await executeAction(f.root, prepared.actionId, randomUUID());
  await f.write('shared.txt', 'resolved\n');
  await f.perform('stage-resolved', { paths: ['shared.txt'] });
  await f.perform('continue', { operation: 'merge' });
  assert.equal((await filesDetail(f.root, { worktreePath: f.root })).ongoing.length, 0);
  assert.equal((await f.run('show', '-s', '--format=%P', 'HEAD')).trim().split(' ').length, 2);
});

test('rebase conflicts support abort and continue without opening an editor', async () => {
  const f = await fixture();
  await f.run('switch', '-c', 'other'); await f.commit('shared.txt', 'other\n');
  await f.run('switch', 'main'); const before = await f.commit('shared.txt', 'main\n');
  let prepared = await f.prepare('rebase', { ref: 'refs/heads/other', confirm: true });
  await executeAction(f.root, prepared.actionId, randomUUID());
  assert.ok((await filesDetail(f.root, { worktreePath: f.root })).ongoing.includes('rebase-merge'));
  await f.perform('abort', { operation: 'rebase', confirm: true });
  assert.equal(await f.head(), before);
  prepared = await f.prepare('rebase', { ref: 'refs/heads/other', confirm: true });
  await executeAction(f.root, prepared.actionId, randomUUID());
  await f.write('shared.txt', 'combined\n');
  await f.perform('stage-resolved', { paths: ['shared.txt'] });
  await f.perform('continue', { operation: 'rebase' });
  assert.equal((await f.run('branch', '--show-current')).trim(), 'main');
  assert.equal((await filesDetail(f.root, { worktreePath: f.root })).ongoing.length, 0);
  assert.equal(await readFile(path.join(f.root, 'shared.txt'), 'utf8'), 'combined\n');
});

test('cherry-pick and revert conflicts preserve recovery state and reject the wrong operation', async () => {
  for (const action of ['cherry-pick', 'revert']) {
    const f = await fixture();
    let target;
    if (action === 'cherry-pick') {
      await f.run('switch', '-c', 'other'); target = await f.commit('shared.txt', 'other\n'); await f.run('switch', 'main');
    } else target = await f.commit('shared.txt', 'to revert\n');
    const before = await f.commit('shared.txt', 'current\n');
    const prepared = await f.prepare(action, { ref: target });
    const result = await executeAction(f.root, prepared.actionId, randomUUID());
    assert.equal(result.state, 'failed');
    assert.equal(result.observedState.conflicts, 1);
    await assert.rejects(f.prepare('abort', { operation: 'merge', confirm: true }), /没有进行中/);
    await f.perform('abort', { operation: action, confirm: true });
    assert.equal(await f.head(), before);
    assert.equal(await readFile(path.join(f.root, 'shared.txt'), 'utf8'), 'current\n');
  }
});
