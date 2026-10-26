import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createPanelManager } from '../src/panel-manager.mjs';
import { createFixture } from './fixture.mjs';

function fakeStart() {
  const created = [];
  return { created, start: async ({ repositoryPath, now }) => {
    const server = new EventEmitter();
    server.listening = true;
    const panel = { server, repositoryPath, lastActivity: now(), activeRequests: 0, close: async () => { server.listening = false; server.emit('close'); } };
    created.push(panel);
    return panel;
  } };
}

test('panel pool reuses concurrent opens, evicts least recently used listeners and reopens closed panels', async t => {
  let clock = 1;
  const fake = fakeStart();
  const pool = createPanelManager({ ...fake, maxPanels: 2, idleTimeoutMs: 0, now: () => clock });
  t.after(() => pool.close());
  const [a, same] = await Promise.all([pool.open('a'), pool.open('a')]);
  assert.equal(a, same);
  clock++; const b = await pool.open('b');
  clock++; await pool.open('a');
  clock++; const c = await pool.open('c');
  assert.equal(b.server.listening, false);
  assert.equal(a.server.listening, true);
  assert.equal(pool.size, 2);
  await c.close();
  assert.equal(pool.size, 1);
  assert.notEqual(await pool.open('c'), c);
});

test('idle reclamation respects authenticated activity and never closes an in-flight request', async t => {
  let clock = 0;
  const fake = fakeStart();
  const pool = createPanelManager({ ...fake, maxPanels: 1, idleTimeoutMs: 1000, now: () => clock });
  t.after(() => pool.close());
  const a = await pool.open('a');
  clock = 900; a.lastActivity = clock;
  clock = 1500; await pool.sweep();
  assert.equal(pool.size, 1);
  a.activeRequests = 1;
  clock = 3000; await pool.sweep();
  await assert.rejects(pool.open('b'), /处理请求/);
  assert.equal(a.server.listening, true);
  a.activeRequests = 0;
  await pool.sweep();
  assert.equal(pool.size, 0);
  await pool.open('b');
});

test('startup failure does not poison subsequent open and shutdown disallows new listeners', async () => {
  const fake = fakeStart();
  let fail = true;
  const pool = createPanelManager({ start: args => { if (fail) { fail = false; throw new Error('listen failed'); } return fake.start(args); } });
  await assert.rejects(pool.open('a'), /listen failed/);
  const a = await pool.open('a');
  await pool.close();
  assert.equal(a.server.listening, false);
  await assert.rejects(pool.open('b'), /正在关闭/);
});

test('real listeners at capacity close and reopen with fresh credentials', async t => {
  const fixture = await createFixture();
  const pool = createPanelManager({ html: '<title>Lifecycle</title>', maxPanels: 2 });
  t.after(() => pool.close());
  const first = await pool.open(fixture.root);
  const headers = { Authorization: `Bearer ${first.token}` };
  assert.equal((await fetch(`${first.origin}/api/preferences`, { headers })).status, 200);
  await pool.open(fixture.linked);
  await pool.open(fixture.detached);
  assert.equal(first.server.listening, false);
  const replacement = await pool.open(fixture.root);
  assert.notEqual(replacement.token, first.token);
  assert.equal((await fetch(`${replacement.origin}/api/preferences`, { headers })).status, 401);
  assert.equal((await fetch(`${replacement.origin}/api/preferences`, { headers: { Authorization: `Bearer ${replacement.token}` } })).status, 200);
});

test('default pool accepts more than ten repositories by reclaiming listeners', async t => {
  const fake = fakeStart();
  const pool = createPanelManager({ ...fake });
  t.after(() => pool.close());
  for (let i = 0; i < 12; i++) await pool.open(`repo-${i}`);
  assert.equal(pool.size, 10);
  assert.equal(fake.created[0].server.listening, false);
  assert.equal(fake.created[11].server.listening, true);
});
