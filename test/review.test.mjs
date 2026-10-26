import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { createFixture } from './fixture.mjs';
import { git, snapshot } from '../src/git.mjs';
import { repositoryInfo, commitInfo, refInfo, reviewFiles, reviewDiff, fileContent } from '../src/review.mjs';

test('history pages, multiple refs, globs, visibility and first parent preserve scope', async () => {
  const f = await createFixture();
  const full = await snapshot(f.root);
  const first = await snapshot(f.root, { limit: 2 });
  const second = await snapshot(f.root, { limit: 2, offset: first.nextOffset });
  assert.deepEqual([...first.commits, ...second.commits].map(c => c.hash), full.commits.slice(0, 4).map(c => c.hash));
  const scopes = ['refs/heads/feat/commit-detail', 'refs/heads/codex/worktree-panel'];
  const multi = await snapshot(f.root, { scopes });
  const expected = (await git(f.root, ['rev-list', ...scopes])).trim().split('\n');
  assert.deepEqual(new Set(multi.commits.map(c => c.hash)), new Set(expected));
  const glob = await snapshot(f.root, { branchGlob: 'heads/feat/*' });
  assert.deepEqual(new Set(glob.commits.map(c => c.hash)), new Set([f.first, f.feature]));
  assert.equal((await snapshot(f.root, { branchGlob: 'missing/*' })).commits.length, 0);
  const hidden = await snapshot(f.root, { showTags: false, showRemotes: false });
  assert.ok(hidden.refs.every(r => !['tag', 'remote'].includes(r.type)));
  const parent = await snapshot(f.root, { scope: 'refs/heads/main', firstParent: true });
  assert.ok(!parent.commits.some(c => c.hash === f.feature));
  assert.ok(parent.commits.some(c => c.hash === f.merge));
  await assert.rejects(snapshot(f.root, { scopes: ['--all'] }), /不存在/);
  await assert.rejects(snapshot(f.root, { offset: -1 }), /偏移/);
  await assert.rejects(snapshot(f.root, { firstParent: 'true' }), /布尔/);
});

test('repository, signature, containment, annotated tag metadata and full stash list', async () => {
  const f = await createFixture();
  await git(f.root, ['remote', 'add', 'origin', f.directory]);
  await git(f.root, ['remote', 'set-url', '--push', 'origin', f.linked]);
  const info = await repositoryInfo(f.root);
  assert.equal(info.remotes[0].name, 'origin');
  assert.equal(info.remotes[0].fetchUrl, f.directory);
  assert.equal(info.remotes[0].pushUrl, f.linked);
  const commit = await commitInfo(f.root, f.first);
  assert.equal(commit.author.name, 'Alex Chen');
  assert.equal(commit.signature.status, 'N');
  assert.equal(commit.includedInHead, true);
  assert.ok(commit.branches.includes('refs/heads/main'));
  assert.ok(commit.tags.includes('refs/tags/v0.1.0'));
  const tag = await refInfo(f.root, 'refs/tags/v0.1.0');
  assert.equal(tag.annotated, true);
  assert.match(tag.message, /First preview/);
  assert.equal(tag.email, 'alex@example.test');
  await git(f.root, ['stash', 'push', '-u', '-m', 'one']);
  await appendFile(path.join(f.root, 'README.md'), 'another\n');
  await git(f.root, ['stash', 'push', '-m', 'two']);
  const stashes = (await repositoryInfo(f.root)).stashes;
  assert.equal(stashes.length, 2);
  assert.equal(stashes[0].ref, 'stash@{0}');
  assert.match(stashes[0].message, /two/);
  assert.match(stashes[1].hash, /^[a-f0-9]{40}$/);
  const graph = await snapshot(f.root);
  assert.ok(stashes.every(s => graph.commits.some(c => c.hash === s.hash)));
});

test('remote metadata redacts URL credentials without changing config and metadata errors are sanitized', async () => {
  const f = await createFixture();
  const fetchUrl = 'https://example-user:secret-pass@example.test/repository.git?access_token=private-value&other=kept';
  const pushUrl = 'https://oauth2:another-secret@example.test/repository.git?private_token=hidden-value';
  await git(f.root, ['remote', 'add', 'sensitive', fetchUrl]);
  await git(f.root, ['remote', 'set-url', '--push', 'sensitive', pushUrl]);
  const remote = (await repositoryInfo(f.root)).remotes.find(remote => remote.name === 'sensitive');
  assert.equal(remote.credentialsRedacted, true);
  assert.doesNotMatch(JSON.stringify(remote), /example-user|secret-pass|private-value|another-secret|hidden-value/);
  assert.match(remote.fetchUrl, /example\.test\/repository\.git/);
  assert.match(remote.fetchUrl, /other=kept/);
  assert.equal((await git(f.root, ['remote', 'get-url', 'sensitive'])).trim(), fetchUrl);
  assert.equal((await git(f.root, ['remote', 'get-url', '--push', 'sensitive'])).trim(), pushUrl);
  const missing = path.join(f.directory, 'token=error-secret');
  for (const read of [() => repositoryInfo(missing), () => commitInfo(missing, f.first), () => refInfo(missing, 'refs/tags/v0.1.0')]) {
    await assert.rejects(read(), error => !error.message.includes('error-secret') && error.message.includes('[redacted]'));
  }
});

test('historical working comparison, untracked and renamed paths, bounded file versions', async () => {
  const f = await createFixture();
  const input = { worktreePath: f.root, a: f.first };
  const detail = await reviewFiles(f.root, input);
  assert.equal(detail.comparison, true);
  assert.equal(detail.a, f.first);
  const readme = detail.files.find(f => f.path === 'README.md');
  assert.equal(readme.group, 'comparison');
  const diff = await reviewDiff(f.root, { ...input, fileId: readme.id, version: detail.version });
  assert.match(diff.patch, /Local pending changes/);
  const renamed = detail.files.find(f => f.originalPath === 'rename me.txt');
  assert.ok(renamed);
  assert.equal((await fileContent(f.root, { ...input, fileId: renamed.id, revision: 'before' })).text, 'original\n');
  const untracked = detail.files.find(f => f.path === 'untracked.txt');
  assert.match((await reviewDiff(f.root, { ...input, fileId: untracked.id })).patch, /<script>/);
  assert.equal((await fileContent(f.root, { ...input, fileId: untracked.id, revision: 'before' })).missing, true);
  const stagedInput = { worktreePath: f.root, fileId: 'staged:重命名 file.txt' };
  await appendFile(path.join(f.root, '重命名 file.txt'), 'working only\n');
  assert.equal((await fileContent(f.root, { ...stagedInput, revision: 'after' })).text, 'original\n');
  assert.match((await fileContent(f.root, { ...stagedInput, revision: 'current' })).text, /working only/);
  await assert.rejects(reviewDiff(f.root, { ...input, fileId: readme.id, version: detail.version }), /变化/);
  await assert.rejects(fileContent(f.root, { ...input, fileId: '../outside' }), /清单/);
  await writeFile(path.join(f.root, 'large.txt'), 'x'.repeat(300000));
  const large = await fileContent(f.root, { ...input, fileId: 'untracked:large.txt' });
  assert.equal(large.truncated, true); assert.equal(large.text.length, 262144);
  await writeFile(path.join(f.root, 'binary.bin'), Buffer.from([0, 1, 2]));
  assert.equal((await fileContent(f.root, { ...input, fileId: 'untracked:binary.bin' })).binary, true);
});

test('reflog history recovers orphaned commits and untracked replacement compares contents', async () => {
  const f = await createFixture();
  await git(f.root, ['add', '.']); await git(f.root, ['commit', '-m', 'clean fixture']);
  await git(f.root, ['checkout', '-b', 'temporary']);
  await git(f.root, ['commit', '--allow-empty', '-m', 'orphaned commit']);
  const orphan = (await git(f.root, ['rev-parse', 'HEAD'])).trim();
  await git(f.root, ['checkout', 'main']); await git(f.root, ['branch', '-D', 'temporary']);
  assert.ok(!(await snapshot(f.root)).commits.some(c => c.hash === orphan));
  assert.ok((await snapshot(f.root, { includeReflogs: true })).commits.some(c => c.hash === orphan));
  await git(f.root, ['rm', '--cached', 'README.md']);
  await appendFile(path.join(f.root, 'README.md'), 'replacement\n');
  const input = { worktreePath: f.root, a: f.first, fileId: 'comparison:README.md' };
  const detail = await reviewFiles(f.root, input);
  assert.equal(detail.files.filter(f => f.path === 'README.md').length, 1);
  const diff = await reviewDiff(f.root, input);
  assert.match(diff.patch, /\+replacement/);
  assert.match(diff.patch, /-# Orbit Studio/);
});
