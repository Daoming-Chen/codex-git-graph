import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { snapshot, commitDetail, worktreeDetail } from './git.mjs';
import { startHttp } from './http.mjs';
import { actionNames, resolveRef, prepareAction, executeAction } from './actions.mjs';
import { repositoryInfo, commitInfo, refInfo, reviewFiles, reviewDiff, fileContent } from './review.mjs';
import { readPreferences, savePreferences } from './preferences.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
async function readUi() {
  for (const filename of [path.join(here, 'graph.html'), path.join(here, '../plugins/codex-git-graph/dist/graph.html')]) {
    try { return await readFile(filename, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  throw new Error('请先运行 npm run build，生成 Git Graph 面板。');
}

export function createMcpServer(html) {
  const mcp = new McpServer({ name: 'codex-git-graph', version: '0.3.0' });
  const uri = 'ui://git-graph/panel.html';
  const panels = new Map();
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  registerAppResource(mcp, 'git-graph-panel', uri, {}, async () => ({ contents: [{
    uri, mimeType: RESOURCE_MIME_TYPE, text: html,
    _meta: { ui: { prefersBorder: false, csp: { connectDomains: [], resourceDomains: [] } } },
  }] }));
  const safely = fn => async args => {
    try { return { content: [], structuredContent: await fn(args) }; }
    catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  };
  const repo = { repositoryPath: z.string().optional().describe('Absolute repository path from the active task. Required unless GIT_GRAPH_REPO is configured.') };
  const requiredRepo = input => {
    const selected = input || process.env.GIT_GRAPH_REPO;
    if (!selected) throw new Error('请先选择仓库。');
    return selected;
  };
  registerAppTool(mcp, 'git_graph_open', {
    title: 'Git Graph', description: 'Open Git history and local worktree review with explicitly prepared local Git actions. Pass the absolute task repository path. Returns a loopback browser panel URL.',
    inputSchema: { ...repo, limit: z.number().int().min(1).max(2000).default(300), offset:z.number().int().nonnegative().default(0), scope: z.string().default(''), scopes:z.array(z.string()).optional(),branchGlob:z.string().optional(),firstParent:z.boolean().optional(),includeReflogs:z.boolean().optional(),showRemotes:z.boolean().optional(),showTags:z.boolean().optional(),showStashes:z.boolean().optional() }, annotations,
    _meta: { ui: { resourceUri: uri }, 'openai/ui': { entrypoints: [{ type: 'thread' }] } },
  }, safely(async ({ repositoryPath, ...options }) => {
    const selected = repositoryPath || process.env.GIT_GRAPH_REPO;
    if (!selected) return { needsRepository: true };
    const data = await snapshot(selected, options);
    const key = data.repository.path;
    if (!panels.has(key)) {
      if (panels.size >= 10) throw new Error('已打开 10 个仓库面板，请重启插件后继续。');
      panels.set(key, startHttp({ repositoryPath: key, html }).catch(e => { panels.delete(key); throw e; }));
    }
    const panel = await panels.get(key);
    return { ...data, panelUrl: panel.url };
  }));
  registerAppTool(mcp, 'git_graph_commit', {
    title: '查看提交', description: 'Read commit details and a bounded patch; merges compare to the first parent.',
    inputSchema: { ...repo, hash: z.string().regex(/^[a-f0-9]{40,64}$/) }, annotations,
    _meta: { ui: { resourceUri: uri, visibility: ['app', 'model'] } },
  }, safely(({ repositoryPath, hash }) => commitDetail(requiredRepo(repositoryPath), hash)));
  registerAppTool(mcp, 'git_graph_worktree', {
    title: '查看 Worktree 改动', description: 'Read staged and unstaged diffs plus untracked filenames for a worktree in this repository.',
    inputSchema: { ...repo, worktreePath: z.string() }, annotations,
    _meta: { ui: { resourceUri: uri, visibility: ['app', 'model'] } },
  }, safely(({ repositoryPath, worktreePath }) => worktreeDetail(requiredRepo(repositoryPath), worktreePath)));
  const input = z.object({ worktreePath: z.string().optional(), hash: z.string().optional(), a: z.string().optional(), b: z.string().optional(), parent: z.number().int().optional(), fileId: z.string().optional(), version: z.string().optional(),revision:z.enum(['current','before','after']).optional() }).strict();
  for (const [name, fn] of [['files', reviewFiles], ['diff', reviewDiff], ['file_content',fileContent]]) registerAppTool(mcp, `git_graph_${name}`, {
    title: name === 'files' ? '读取变更文件' : '读取单文件差异', description: 'Read structured changes or one listed file diff.', inputSchema: { ...repo, input }, annotations,
    _meta: { ui: { resourceUri: uri, visibility: ['app', 'model'] } },
  }, safely(({ repositoryPath, input }) => fn(requiredRepo(repositoryPath), input)));
  for(const [name,fn,field] of [['repository_info',repositoryInfo,null],['commit_info',commitInfo,'hash'],['ref_info',refInfo,'ref']]) registerAppTool(mcp,`git_graph_${name}`,{
    title:{repository_info:'查看远程仓库和 Stash',commit_info:'查看提交元数据',ref_info:'查看引用元数据'}[name],description:'Read repository metadata without modifying Git state.',inputSchema:{...repo,...(field?{[field]:z.string()}: {})},annotations,_meta:{ui:{resourceUri:uri,visibility:['app','model']}},
  },safely(args=>fn(requiredRepo(args.repositoryPath),field?args[field]:undefined)));
  registerAppTool(mcp, 'git_graph_resolve', { title: '解析引用', description: 'Resolve a full ref or immutable SHA.', inputSchema: { ...repo, ref: z.string() }, annotations, _meta: { ui: { resourceUri: uri, visibility: ['app', 'model'] } } }, safely(({ repositoryPath, ref }) => resolveRef(requiredRepo(repositoryPath), ref)));
  registerAppTool(mcp, 'git_graph_preferences', {title:'读取仓库偏好与审阅进度',description:'Read durable plugin preferences and review progress shared by the repository worktrees.',inputSchema:repo,annotations,_meta:{ui:{resourceUri:uri,visibility:['app','model']}}},safely(({repositoryPath})=>readPreferences(requiredRepo(repositoryPath))));
  registerAppTool(mcp, 'git_graph_save_preferences', {title:'保存仓库偏好与审阅进度',description:'Save plugin-only settings and review progress in the Git common directory. Does not modify refs, index, Git configuration or working files.',inputSchema:{...repo,input:z.record(z.string(),z.unknown())},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false},_meta:{ui:{resourceUri:uri,visibility:['app','model']}}},safely(({repositoryPath,input})=>savePreferences(requiredRepo(repositoryPath),input)));
  registerAppTool(mcp, 'git_graph_prepare', { title: '检查 Git 操作', description: 'Validate and prepare a typed Git action; does not execute it. Destructive actions require explicit confirmation. Expires after two minutes.', inputSchema: { ...repo, action: z.enum(actionNames), payload: z.record(z.string(), z.unknown()), expectedVersion: z.string().optional() }, annotations, _meta: { ui: { resourceUri: uri, visibility: ['app', 'model'] } } }, safely(({ repositoryPath, action, payload, expectedVersion }) => prepareAction(requiredRepo(repositoryPath), action, payload, expectedVersion)));
  registerAppTool(mcp, 'git_graph_execute', { title: '执行已检查的 Git 操作', description: 'Execute a prepared action once with state revalidation. Can modify local and remote Git state, rewrite history, or discard explicitly selected changes. Runs normal Git hooks.', inputSchema: { ...repo, actionId: z.string().uuid(), operationId: z.string().uuid() }, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }, _meta: { ui: { resourceUri: uri, visibility: ['app', 'model'] } } }, safely(({ repositoryPath, actionId, operationId }) => executeAction(requiredRepo(repositoryPath), actionId, operationId)));
  return { mcp, close: async () => {
    await Promise.all([...panels.values()].map(async p => (await p).server.close()));
    await mcp.close();
  } };
}

async function main() {
  const args = process.argv.slice(2);
  const get = flag => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
  const html = await readUi();
  if (args.includes('--http')) {
    const panel = await startHttp({ repositoryPath: path.resolve(get('--repo') || process.env.GIT_GRAPH_REPO || process.cwd()), html, port: Number(get('--port') || 0) });
    console.log(`Git Graph: ${panel.url}`);
    process.once('SIGINT', () => panel.server.close());
    process.once('SIGTERM', () => panel.server.close());
  } else {
    const server = createMcpServer(html);
    await server.mcp.connect(new StdioServerTransport());
    process.stdin.once('end', () => { void server.close(); });
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
