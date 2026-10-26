import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutGraph } from '../src/graph.mjs';
const c = (hash, ...parents) => ({ hash, parents });
test('linear history keeps one lane, starts without an incoming edge and terminates at root', () => {
  const { rows, width } = layoutGraph([c('a', 'b'), c('b', 'c'), c('c')]);
  assert.equal(width, 1); assert.deepEqual(rows.map(r => r.column), [0, 0, 0]);
  assert.deepEqual(rows[0].incoming, []); assert.deepEqual(rows[2].outgoing, []);
});
test('merge parents get distinct lanes and rejoin their common ancestor', () => {
  const { rows } = layoutGraph([c('merge', 'left', 'right'), c('left', 'base'), c('right', 'base'), c('base')]);
  assert.notEqual(rows[0].outgoing[0].to, rows[0].outgoing[1].to);
  assert.equal(rows[1].column, rows[0].outgoing[0].to);
  assert.equal(rows[2].column, rows[0].outgoing[1].to);
  assert.equal(rows[2].outgoing[0].to, rows[3].column);
  assert.equal(rows[1].passing.length, 1);
});
test('working changes attach to their own HEAD, including multiple worktrees on one HEAD', () => {
  const trees = ['one', 'two'].map(p => ({ path: p, head: 'a', status: { total: 1 } }));
  const { rows } = layoutGraph([c('a', 'b'), c('b')], trees);
  assert.deepEqual(rows.slice(0, 2).map(r => r.kind), ['working', 'working']);
  assert.deepEqual(rows[0].parents, ['a']); assert.deepEqual(rows[1].parents, ['a']);
  assert.equal(rows[2].kind, 'commit');
});
test('octopus merges, disconnected roots and truncated parents do not duplicate frontier slots', () => {
  const { rows } = layoutGraph([c('m', 'a', 'b', 'c'), c('a', 'base'), c('b', 'base'), c('c', 'outside'), c('base'), c('unrelated')]);
  assert.equal(new Set(rows[0].outgoing.map(e => e.to)).size, 3);
  assert.equal(rows[3].outgoing.length, 1);
  assert.equal(rows[5].incoming.length, 0);
});
