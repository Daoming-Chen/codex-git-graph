import { fileURLToPath } from 'node:url';
import { resolveRepository } from './git.mjs';

// MCP roots are the only standardized filesystem context exposed by this SDK.
// A root is a workspace boundary, not a guarantee of the active thread's repo.
export async function repositoryContext(server, { repositoryPath, environmentPath = process.env.GIT_GRAPH_REPO, signal, resolve = resolveRepository } = {}) {
  const resolved = async (input, source) => {
    const { root } = await resolve(input);
    return { repositoryPath: root, needsRepository: false, context: { source, status: 'resolved', candidates: [{ path: root }] } };
  };
  if (repositoryPath) return resolved(repositoryPath, 'explicit');
  if (server.getClientCapabilities()?.roots) {
    let roots;
    try { ({ roots } = await server.listRoots({}, { timeout: 5000, signal })); }
    catch (error) {
      return { needsRepository: true, context: { source: 'roots', status: 'error', candidates: [], reason: `无法读取宿主 Workspace：${error.message}` } };
    }
    if (roots.length > 32) return { needsRepository: true, context: { source: 'roots', status: 'ambiguous', candidates: [], reason: '宿主提供的 Workspace 过多，请明确选择仓库。' } };
    const candidates = [];
    for (const entry of roots) {
      try {
        const url = new URL(entry.uri);
        if (url.protocol !== 'file:') continue;
        const { root } = await resolve(fileURLToPath(url));
        if (!candidates.some(candidate => candidate.path === root)) candidates.push({ path: root, ...(entry.name ? { name: entry.name } : {}) });
      } catch { /* Non-local or non-Git roots cannot bind a Git panel. */ }
    }
    if (candidates.length === 1) return { repositoryPath: candidates[0].path, needsRepository: false, context: { source: 'roots', status: 'resolved', candidates } };
    if (roots.length) return { needsRepository: true, context: { source: 'roots', status: candidates.length > 1 ? 'ambiguous' : 'unavailable', candidates, reason: candidates.length > 1 ? '宿主提供了多个仓库，未指定当前会话仓库。请选择仓库。' : '宿主 Workspace 未提供可访问的本地 Git 仓库。' } };
  }
  if (environmentPath) return resolved(environmentPath, 'environment');
  return { needsRepository: true, context: { source: 'none', status: 'unavailable', candidates: [], reason: '宿主未提供可用的仓库上下文，请选择仓库。' } };
}
