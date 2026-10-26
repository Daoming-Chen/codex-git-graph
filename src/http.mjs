import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { snapshot, commitDetail, worktreeDetail, resolveRepository } from './git.mjs';
import { filesDetail, fileDiff, resolveRef, prepareAction, executeAction } from './actions.mjs';

export async function startHttp({ repositoryPath, html, port = 0, devHarness = false }) {
  const { root } = await resolveRepository(repositoryPath);
  const token = randomBytes(32).toString('hex');
  let origin;
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) {
      res.writeHead(403).end('Forbidden'); return;
    }
    const url = new URL(req.url, origin);
    if (devHarness && url.pathname === '/__layout' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<!doctype html><meta charset="utf-8"><title>Development layout harness</title><style>body{margin:0;background:#333}iframe{border:0;display:block}</style><iframe id="product" title="Git Graph actual product" height="720"></iframe><script>const p=new URLSearchParams(location.search),w=Number(p.get('width'));document.querySelector('iframe').width=[420,640,960,1280].includes(w)?w:1280;document.querySelector('iframe').src='/'+location.hash;</script>`); return;
    }
    if (!['GET', 'POST'].includes(req.method)) { res.writeHead(405).end('Method not allowed'); return; }
    if (url.pathname === '/' && req.method === 'GET') {
      res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; frame-ancestors 'self'");
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html); return;
    }
    const supplied = Buffer.from((req.headers.authorization || '').replace(/^Bearer /, ''));
    if (supplied.length !== token.length || !timingSafeEqual(supplied, Buffer.from(token))) {
      res.writeHead(401).end('Unauthorized'); return;
    }
    try {
      let data;
      const writable = ['/api/prepare', '/api/execute'].includes(url.pathname);
      if ((writable && req.method !== 'POST') || (!writable && req.method !== 'GET')) { res.writeHead(405).end('Method not allowed'); return; }
      let body;
      if (writable) {
        if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new Error('必须使用 JSON。');
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 128 * 1024) throw new Error('请求过大。'); chunks.push(chunk); }
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      }
      if (url.pathname === '/api/snapshot') data = await snapshot(root, { limit: Number(url.searchParams.get('limit') || 300), scope: url.searchParams.get('scope') || '' });
      else if (url.pathname === '/api/commit') data = await commitDetail(root, url.searchParams.get('hash') || '');
      else if (url.pathname === '/api/worktree') data = await worktreeDetail(root, url.searchParams.get('path') || '');
      else if (url.pathname === '/api/files') data = await filesDetail(root, JSON.parse(url.searchParams.get('input') || '{}'));
      else if (url.pathname === '/api/diff') data = await fileDiff(root, JSON.parse(url.searchParams.get('input') || '{}'));
      else if (url.pathname === '/api/resolve') data = await resolveRef(root, url.searchParams.get('ref') || '');
      else if (url.pathname === '/api/prepare') data = await prepareAction(root, body.action, body.payload, body.expectedVersion);
      else if (url.pathname === '/api/execute') data = await executeAction(root, body.actionId, body.operationId);
      else { res.writeHead(404).end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(data));
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, url: `${origin}/#token=${token}`, origin, token };
}
