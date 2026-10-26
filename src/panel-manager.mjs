import { startHttp } from './http.mjs';

// Bound loopback listeners, not repository data. Closing a listener never retries
// an action; callers reopen through MCP to receive a fresh URL and token.
export function createPanelManager({ html, maxPanels = 10, idleTimeoutMs = 30 * 60 * 1000, start = startHttp, now = Date.now } = {}) {
  if (!Number.isInteger(maxPanels) || maxPanels < 1) throw new Error('maxPanels must be a positive integer');
  const panels = new Map();
  let closing = false;
  let queue = Promise.resolve();
  const serialized = fn => {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  };
  const stop = async (key, entry) => {
    if (panels.get(key) === entry) panels.delete(key);
    await (entry.panel.close ? entry.panel.close() : new Promise((resolve, reject) => {
      entry.panel.server.close(error => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve());
      entry.panel.server.closeIdleConnections?.();
    }));
  };
  const touched = entry => Math.max(entry.lastUsed, entry.panel.lastActivity ?? 0);
  const candidates = () => [...panels].filter(([, entry]) => !entry.panel.activeRequests).sort((a, b) => touched(a[1]) - touched(b[1]));
  const sweep = () => serialized(async () => {
    for (const [key, entry] of candidates()) if (now() - touched(entry) >= idleTimeoutMs) await stop(key, entry);
  });
  const timer = idleTimeoutMs > 0 ? setInterval(() => { void sweep().catch(() => {}); }, Math.min(idleTimeoutMs, 60_000)) : null;
  timer?.unref();
  return {
    get size() { return panels.size; },
    async open(repositoryPath) {
      return serialized(async () => {
        if (closing) throw new Error('Git Graph 服务正在关闭，请重新打开插件。');
        const existing = panels.get(repositoryPath);
        if (existing?.panel.server.listening) {
          existing.lastUsed = now();
          return existing.panel;
        }
        if (existing) await stop(repositoryPath, existing);
        while (panels.size >= maxPanels) {
          const oldest = candidates()[0];
          if (!oldest) throw new Error('所有仓库面板都在处理请求，请稍后再打开。');
          await stop(...oldest);
        }
        const panel = await start({ repositoryPath, html, now });
        const entry = { panel, lastUsed: now() };
        panels.set(repositoryPath, entry);
        panel.server.once('close', () => { if (panels.get(repositoryPath) === entry) panels.delete(repositoryPath); });
        return panel;
      });
    },
    sweep,
    close() {
      closing = true;
      clearInterval(timer);
      return serialized(async () => { await Promise.all([...panels].map(([key, entry]) => stop(key, entry))); });
    },
  };
}
