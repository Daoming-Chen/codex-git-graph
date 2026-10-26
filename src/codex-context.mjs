import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

// Desktop 26.1021 sends both aliases on mcpServer/tool/call. Resolve each
// request separately: one MCP process can serve several conversations.
export function codexThreadId(meta) {
  const ids = [meta?.thread_id, meta?.threadId].filter(value => value !== undefined);
  if (!ids.length || ids.some(id => typeof id !== 'string' || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id))) return null;
  return ids.every(id => id === ids[0]) ? ids[0] : null;
}

async function readThread(home, id) {
  const files = (await readdir(home)).filter(name => /^state_\d+\.sqlite$/.test(name))
    .sort((a, b) => Number(b.match(/\d+/)[0]) - Number(a.match(/\d+/)[0]));
  if (!files.length) return null;
  // Keep this optional: other MCP hosts and older Node runtimes still use roots.
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(home, files[0]), { readOnly: true });
  try {
    return db.prepare('SELECT cwd, thread_source FROM threads WHERE id = ?').get(id) ?? null;
  } finally { db.close(); }
}

export async function codexRepositoryHint(meta, {
  home = process.env.CODEX_HOME || path.join(homedir(), '.codex'),
  lookupThread = readThread,
} = {}) {
  const threadId = codexThreadId(meta);
  if (!threadId) return null;
  try {
    const thread = await lookupThread(home, threadId);
    if (thread && thread.thread_source !== 'mcp_extension_host') {
      if (typeof thread.cwd !== 'string' || !path.isAbsolute(thread.cwd)) return { error: '当前聊天没有可用的本地工作目录。' };
      return { paths: [thread.cwd], source: 'codex-thread' };
    }
    // Static entrypoints on a new composer use an ephemeral transport thread,
    // which has no persisted row. Use the selected project's own rootPaths;
    // active-workspace-roots is legacy state and may point at a different repo.
    const file = path.join(home, '.codex-global-state.json');
    if ((await stat(file)).size > 8 * 1024 * 1024) return { error: '本机项目记录过大，无法自动读取仓库。' };
    const state = JSON.parse(await readFile(file, 'utf8'));
    const selected = state['selected-project'];
    if (selected?.type !== 'local' || typeof selected.projectId !== 'string') return null;
    const project = state['local-projects']?.[selected.projectId];
    const paths = project?.rootPaths;
    if (!Array.isArray(paths) || !paths.length || paths.length > 32 || paths.some(p => typeof p !== 'string' || !path.isAbsolute(p))) return null;
    return { paths: [...new Set(paths)], source: 'codex-project' };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    return { error: '无法读取本机聊天或项目的工作目录，请检查本机上下文访问权限。' };
  }
}
