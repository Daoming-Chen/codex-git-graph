import test from 'node:test';
import assert from 'node:assert/strict';
import { access, cp, mkdtemp, mkdir, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { packagePlugin } from '../scripts/package.mjs';

test('portable distribution launches after relocation outside the source checkout and restarts cleanly', async t => {
  const base = path.resolve('.test-output');
  await mkdir(base, { recursive: true });
  const parent = await mkdtemp(path.join(base, 'portable-'));
  const packaged = await packagePlugin(path.join(parent, 'first location 中文'));
  const relocated = path.join(parent, 'moved plugin with spaces');
  await rename(packaged, relocated);
  await assert.rejects(access(path.join(relocated, '.mcp.json')), { code: 'ENOENT' });
  const manifest = JSON.parse(await readFile(path.join(relocated, 'plugin.json'), 'utf8'));
  assert.equal(manifest.name, 'workgraph');
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const marketplace = JSON.parse(await readFile('.agents/plugins/marketplace.json', 'utf8'));
  assert.equal(manifest.name, pkg.name);
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.extensions['com.openai'].interface.displayName, 'WorkGraph');
  assert.equal(marketplace.plugins[0].name, manifest.name);
  assert.equal(marketplace.plugins[0].source.path, './plugins/workgraph');
  assert.match(await readFile(path.join(relocated, 'skills/workgraph/SKILL.md'), 'utf8'), /`workgraph_open`/);
  await assert.rejects(access(path.join(relocated, '.codex-plugin')), { code: 'ENOENT' });
  const portable = JSON.parse(await readFile(path.join(relocated, 'mcp.json'), 'utf8'));
  assert.equal(portable.mcpServers.workgraph.command, 'node');
  assert.deepEqual(portable.mcpServers.workgraph.args, ['${PLUGIN_ROOT}/dist/server.mjs']);
  // SDK is a raw stdio client, not a plugin host. Apply only the documented
  // host placeholder here; this checks relocatability, not host installation.
  const entry = portable.mcpServers.workgraph;
  const config = { ...entry, args: entry.args.map(value => value.replaceAll('${PLUGIN_ROOT}', relocated)), cwd: entry.cwd.replaceAll('${PLUGIN_ROOT}', relocated) };
  assert.equal(config.cwd, relocated);
  for (let i = 0; i < 2; i++) {
    const client = new Client({ name: 'portable-test', version: '1.0.0' });
    const transport = new StdioClientTransport({ ...config, stderr: 'pipe' });
    let diagnostics = '';
    transport.stderr?.on('data', chunk => { diagnostics += chunk; });
    t.after(() => client.close());
    await client.connect(transport);
    assert.ok((await client.listTools()).tools.some(tool => tool.name === 'workgraph_open'), diagnostics);
    const ui = await client.readResource({ uri: 'ui://workgraph/panel.html' });
    assert.match(ui.contents[0].text, /<!doctype html>/i);
    await client.close();
  }
  // A second copy also contains no dependency on the first distribution path.
  const second = path.join(parent, 'another copy');
  await cp(relocated, second, { recursive: true });
  assert.equal(await readFile(path.join(second, 'mcp.json'), 'utf8'), await readFile(path.join(relocated, 'mcp.json'), 'utf8'));
});
