import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { git } from '../src/git.mjs';
import { filesDetail, prepareAction, executeAction } from '../src/actions.mjs';

async function fixture() {
  const directory = path.resolve('.test-output/remote-' + randomUUID()), root = path.join(directory, 'working'), remote = path.join(directory, 'remote.git');
  await mkdir(root, { recursive: true }); await mkdir(remote);
  await git(remote, ['init', '--bare', '-b', 'main']); await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.name', 'Fixture']); await git(root, ['config', 'user.email', 'fixture@example.test']);
  await writeFile(path.join(root, 'file.txt'), 'base\n'); await git(root, ['add', '.']); await git(root, ['commit', '-m', 'base']);
  const perform = async (action, payload) => {
    const version = payload.worktreePath ? (await filesDetail(root, { worktreePath: payload.worktreePath })).version : undefined;
    const prep = await prepareAction(root, action, payload, version), result = await executeAction(root, prep.actionId, randomUUID());
    assert.equal(result.state, 'completed', result.error); return result;
  };
  return { root, remote, directory, perform };
}

test('remote sync uses local bare repositories, supports tracking checkout, tags and prune', async () => {
  const f = await fixture();
  await f.perform('remote-add', { name: 'origin', url: f.remote });
  await f.perform('push', { worktreePath: f.root, remote: 'origin', name: 'main', setUpstream: true });
  assert.equal((await git(f.root, ['rev-parse', '--abbrev-ref', '@{upstream}'])).trim(), 'origin/main');
  await f.perform('fetch', { prune: true });
  await f.perform('branch', { name: 'remote-feature', start: 'refs/heads/main' });
  await f.perform('push', { worktreePath: f.root, remote: 'origin', name: 'remote-feature' });
  await f.perform('remote-branch-delete', { remote: 'origin', name: 'remote-feature', confirm: true });
  await assert.rejects(git(f.remote, ['show-ref', '--verify', 'refs/heads/remote-feature']));
  await f.perform('tag-add', { name: 'v1', start: 'refs/heads/main', message: 'Release one' });
  assert.equal((await git(f.root, ['cat-file', '-t', 'refs/tags/v1'])).trim(), 'tag');
  await f.perform('tag-push', { name: 'v1', remote: 'origin' });
  assert.ok((await git(f.remote, ['show-ref', '--verify', 'refs/tags/v1'])).trim());
  await f.perform('tag-delete', { name: 'v1', confirm: true });
  await f.perform('fetch', { remote: 'origin' });
  await f.perform('track', { worktreePath: f.root, remoteBranch: 'refs/remotes/origin/main', name: 'tracked' });
  assert.equal((await git(f.root, ['symbolic-ref', '--short', 'HEAD'])).trim(), 'tracked');
  const head = (await git(f.root, ['rev-parse', 'HEAD'])).trim();
  await f.perform('checkout', { worktreePath: f.root, hash: head });
  await assert.rejects(git(f.root, ['symbolic-ref', '--short', 'HEAD']));
  await f.perform('switch', { worktreePath: f.root, name: 'main' });
  await f.perform('branch-rename', { name: 'tracked', newName: 'renamed' });
  await f.perform('branch-delete', { name: 'renamed', confirm: true });
  const other = path.join(f.directory, 'other'); await git(f.directory, ['clone', f.remote, other]);
  await git(other, ['config', 'user.name', 'Other']); await git(other, ['config', 'user.email', 'other@example.test']);
  await appendFile(path.join(other, 'file.txt'), 'remote addition\n'); await git(other, ['commit', '-am', 'remote change']); await git(other, ['push', 'origin', 'main']);
  await f.perform('pull', { worktreePath: f.root, remote: 'origin', name: 'main', mode: 'ff-only' });
  assert.equal((await git(f.root, ['rev-parse', 'HEAD'])).trim(), (await git(other, ['rev-parse', 'HEAD'])).trim());
  await git(f.root, ['update-ref', 'refs/remotes/origin/gone', head]);
  await f.perform('remote-prune', { name: 'origin', confirm: true });
  await assert.rejects(git(f.root, ['show-ref', '--verify', 'refs/remotes/origin/gone']));
  await f.perform('remote-edit', { name: 'origin', url: f.remote });
  await f.perform('remote-remove', { name: 'origin', confirm: true });
  assert.equal((await git(f.root, ['remote'])).trim(), '');
});

test('remote/ref actions bind prepared state, reject injection and require destructive confirmation', async () => {
  const f = await fixture(); await f.perform('remote-add', { name: 'origin', url: f.remote });
  await assert.rejects(prepareAction(f.root, 'remote-remove', { name: 'origin' }), /确认/);
  await assert.rejects(prepareAction(f.root, 'remote-add', { name: 'bad', url: 'ext::sh malicious' }), /SSH/);
  await assert.rejects(prepareAction(f.root, 'fetch', { remote: '--upload-pack=bad' }));
  await assert.rejects(prepareAction(f.root, 'push', { worktreePath: f.root, remote: 'origin', name: 'main', force: true }), /未知/);
  await assert.rejects(prepareAction(f.root, 'branch-delete', { name: 'main', confirm: true, force: true }), /占用/);
  const prepared = await prepareAction(f.root, 'fetch', { remote: 'origin' });
  await git(f.root, ['config', 'remote.origin.url', path.join(f.directory, 'different.git')]);
  assert.equal((await executeAction(f.root, prepared.actionId, randomUUID())).state, 'failed');
  await git(f.root, ['config', 'remote.origin.url', f.remote]);
  await git(f.root, ['branch', 'temporary']);
  const deletion = await prepareAction(f.root, 'branch-delete', { name: 'temporary', confirm: true });
  await appendFile(path.join(f.root, 'file.txt'), 'new commit\n'); await git(f.root, ['commit', '-am', 'next']);
  await git(f.root, ['branch', '-f', 'temporary', 'HEAD']);
  assert.equal((await executeAction(f.root, deletion.actionId, randomUUID())).state, 'failed');
  const secret = await prepareAction(f.root, 'remote-edit', { name: 'origin', url: 'https://user:password@example.test/repo.git' });
  assert.doesNotMatch(JSON.stringify(secret), /user:password/);
});

test('remote branch deletion refuses commits published after the last fetch', async () => {
  const f = await fixture(); await f.perform('remote-add', { name: 'origin', url: f.remote });
  await f.perform('branch', { name: 'feature', start: 'refs/heads/main' });
  await f.perform('push', { worktreePath: f.root, remote: 'origin', name: 'feature' });
  await appendFile(path.join(f.root, 'file.txt'), 'next\n'); await git(f.root, ['commit', '-am', 'next']);
  await f.perform('push', { worktreePath: f.root, remote: 'origin', name: 'main' });
  const next = (await git(f.root, ['rev-parse', 'HEAD'])).trim();
  const prepared = await prepareAction(f.root, 'remote-branch-delete', { remote: 'origin', name: 'feature', confirm: true });
  await git(f.remote, ['update-ref', 'refs/heads/feature', next]);
  const result = await executeAction(f.root, prepared.actionId, randomUUID());
  assert.equal(result.state, 'failed');
  assert.equal((await git(f.remote, ['rev-parse', 'refs/heads/feature'])).trim(), next);
});
