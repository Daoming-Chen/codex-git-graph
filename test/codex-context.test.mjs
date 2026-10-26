import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { codexRepositoryHint, codexThreadId } from '../src/codex-context.mjs';
import { repositoryContext } from '../src/workspace-context.mjs';
import { createMcpServer } from '../src/server.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createFixture } from './fixture.mjs';

const a = '01000000-0000-0000-0000-000000000001';
const b = '01000000-0000-0000-0000-000000000002';
const ephemeral = '01000000-0000-0000-0000-000000000003';
async function homeFixture(roots) {
  const base = path.resolve('.test-output');
  await mkdir(base, { recursive: true });
  const home = await mkdtemp(path.join(base, 'codex-context-'));
  const db = new DatabaseSync(path.join(home, 'state_5.sqlite'));
  db.exec('CREATE TABLE threads (id TEXT PRIMARY KEY, cwd TEXT, thread_source TEXT)');
  const insert = db.prepare('INSERT INTO threads VALUES (?, ?, ?)');
  insert.run(a, roots[0], 'user'); insert.run(b, roots[1] || roots[0], 'user');
  db.close();
  await writeFile(path.join(home, '.codex-global-state.json'), JSON.stringify({
    'selected-project': { type: 'local', projectId: 'selected' },
    'local-projects': { selected: { rootPaths: roots } },
    'active-workspace-roots': [path.resolve('unrelated')],
  }));
  return home;
}

test('Codex identity is request-scoped and rejects malformed or conflicting aliases', () => {
  assert.equal(codexThreadId({ thread_id: a, threadId: a }), a);
  for (const meta of [undefined, {}, { thread_id: '../other' }, { thread_id: a, threadId: b }, { threadId: 42 }]) assert.equal(codexThreadId(meta), null);
});

test('exact thread lookup wins over selected project; ephemeral entrypoint uses selected rootPaths', async () => {
  const roots = [path.resolve('repo-A'), path.resolve('repo-B')], home = await homeFixture(roots);
  assert.deepEqual(await codexRepositoryHint({ thread_id: a }, { home }), { paths: [roots[0]], source: 'codex-thread' });
  assert.deepEqual(await codexRepositoryHint({ threadId: b }, { home }), { paths: [roots[1]], source: 'codex-thread' });
  assert.deepEqual(await codexRepositoryHint({ thread_id: ephemeral }, { home }), { paths: roots, source: 'codex-project' });
  assert.equal(await codexRepositoryHint({}, { home }), null, 'do not inspect selected project for an unrelated MCP host');
});

test('remote selection, unreadable database and invalid state never guess a legacy or recent root', async () => {
  const home = await homeFixture([path.resolve('repo-A')]);
  await writeFile(path.join(home, '.codex-global-state.json'), JSON.stringify({
    'selected-project': { type: 'remote', projectId: 'remote' }, 'active-workspace-roots': [process.cwd()],
  }));
  assert.equal(await codexRepositoryHint({ thread_id: ephemeral }, { home }), null);
  await writeFile(path.join(home, 'state_6.sqlite'), 'invalid database');
  assert.ok((await codexRepositoryHint({ thread_id: a }, { home })).error, 'do not fall back to older database or another project');
});

test('thread Git validation takes precedence over roots; explicit path still wins', async () => {
  const server = { getClientCapabilities: () => { throw Error('must not inspect unrelated roots'); } };
  const resolve = async input => { if (input === 'bad') throw Error('not Git'); return { root: input }; };
  const codexHint = async () => ({ paths: ['A'], source: 'codex-thread' });
  assert.equal((await repositoryContext(server, { codexHint, resolve })).repositoryPath, 'A');
  assert.equal((await repositoryContext(server, { repositoryPath: 'explicit', codexHint, resolve })).repositoryPath, 'explicit');
  assert.equal((await repositoryContext(server, { codexHint: async () => ({ paths: ['bad'], source: 'codex-thread' }), resolve })).context.status, 'unavailable');
  assert.equal((await repositoryContext(server, { codexHint: async () => ({ paths: ['A', 'B'], source: 'codex-project' }), resolve })).context.status, 'ambiguous');
});

test('native empty-argument MCP open and polling use the request metadata across chats', async t => {
  const fixture = await createFixture(), home = await homeFixture([fixture.root, fixture.linked]);
  const server = createMcpServer('<title>Codex context</title>', { contextOptions: {
    codexHint: meta => codexRepositoryHint(meta, { home }),
  } });
  const client = new Client({ name: 'codex-desktop-test', version: '1' });
  const [left, right] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.mcp.connect(left); await client.connect(right);
  const call = (name, id) => client.callTool({ name: `workgraph_${name}`, arguments: {}, _meta: { thread_id: id, threadId: id } });
  const opened = (await call('open', a)).structuredContent;
  assert.equal(opened.repository.path, fixture.root);
  assert.equal(opened.context.source, 'codex-thread');
  const [first, second] = await Promise.all([call('context', a), call('context', b)]);
  assert.equal(first.structuredContent.repositoryPath, fixture.root);
  assert.equal(second.structuredContent.repositoryPath, fixture.linked);
  await writeFile(path.join(home, '.codex-global-state.json'), JSON.stringify({
    'selected-project': { type: 'local', projectId: 'selected' },
    'local-projects': { selected: { rootPaths: [fixture.root] } },
  }));
  const entrypoint = (await call('open', ephemeral)).structuredContent;
  assert.equal(entrypoint.repository.path, fixture.root);
  assert.equal(entrypoint.context.source, 'codex-project');
  await writeFile(path.join(home, '.codex-global-state.json'), JSON.stringify({
    'selected-project': { type: 'local', projectId: 'selected' },
    'local-projects': { selected: { rootPaths: [fixture.linked] } },
  }));
  assert.equal((await call('context', ephemeral)).structuredContent.repositoryPath, fixture.linked);
  assert.equal((await call('context', a)).structuredContent.repositoryPath, fixture.root, 'global selection cannot rebind an existing conversation');
});
