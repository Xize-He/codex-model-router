import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Engine } from './engine.mjs';
import { loadRouterConfig } from './config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = loadRouterConfig(root);
const port = Number(process.env.ROUTER_PORT || config.port);
const csrf = randomBytes(32).toString('hex');
const engine = new Engine(root, config), clients = new Set();
const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, '127.0.0.1:7340', 'localhost:7340']);
const json = (res, data, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
const body = async req => { req.setEncoding('utf8'); let b = ''; for await (const chunk of req) { b += chunk; if (b.length > 100000) throw new Error('请求过大'); } return JSON.parse(b || '{}'); };
const binaryBody = async (req, limit = 20 * 1024 * 1024) => {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new Error('单个附件不能超过 20 MB'); chunks.push(chunk); }
  return Buffer.concat(chunks);
};
function authorized(req) {
  if (!allowedHosts.has(req.headers.host)) return false;
  if (req.headers.origin && ![...allowedHosts].some(h => req.headers.origin === `http://${h}`)) return false;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  return true;
}
function validToken(value) { return typeof value === 'string' && value.length === csrf.length && timingSafeEqual(Buffer.from(value), Buffer.from(csrf)); }
let broadcastTimer;
engine.on('change', () => { if (broadcastTimer) return; broadcastTimer = setTimeout(() => { broadcastTimer = null; const frame = `data: ${JSON.stringify(engine.publicState())}\n\n`; for (const client of clients) client.write(frame); }, 80); });
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY');
  if (!authorized(req)) return json(res, { error: '只允许本机同源访问' }, 403);
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  try {
    if (url.pathname === '/api/state' && req.method === 'GET') return json(res, { ...engine.publicState(), csrf });
    if (url.pathname === '/api/events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      clients.add(res); res.write(`data: ${JSON.stringify(engine.publicState())}\n\n`);
      const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 15000);
      req.on('close', () => { clients.delete(res); clearInterval(heartbeat); }); return;
    }
    const attachmentMatch = url.pathname.match(/^\/api\/attachments\/([0-9a-f-]{36})$/i);
    if (attachmentMatch && req.method === 'GET') {
      const { attachment, data } = engine.readAttachment(attachmentMatch[1]);
      const disposition = attachment.kind === 'image' ? 'inline' : 'attachment';
      res.writeHead(200, {
        'Content-Type': attachment.kind === 'image' ? attachment.mime : 'application/octet-stream',
        'Content-Length': data.length,
        'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
        'Cache-Control': 'private, max-age=3600',
      });
      res.end(data); return;
    }
    if (url.pathname === '/api/attachments' && req.method === 'POST') {
      if (!validToken(req.headers['x-router-token'])) return json(res, { error: '会话令牌无效，请刷新页面' }, 403);
      const name = url.searchParams.get('name') || 'attachment';
      const data = await binaryBody(req);
      const attachment = engine.saveAttachment(name, req.headers['content-type'], data);
      return json(res, { id: attachment.id, name: attachment.name, mime: attachment.mime, size: attachment.size, kind: attachment.kind }, 201);
    }
    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'POST') return json(res, { error: 'Method not allowed' }, 405);
      if (!validToken(req.headers['x-router-token'])) return json(res, { error: '会话令牌无效，请刷新页面' }, 403);
      const input = await body(req);
      if (url.pathname === '/api/files/list') {
        const session = input.sessionId ? engine.findSession(input.sessionId) : null;
        if (input.sessionId && !session) throw new Error('会话不存在');
        const base = path.resolve(session?.cwd || engine.cwd);
        const directory = path.resolve(input.path || base);
        const relative = path.relative(base, directory);
        if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('目录不属于当前项目');
        const entries = readdirSync(directory, { withFileTypes: true })
          .filter(entry => !entry.isSymbolicLink() && (entry.isDirectory() || entry.isFile()))
          .map(entry => ({ name: entry.name, path: path.join(directory, entry.name), directory: entry.isDirectory() }))
          .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, undefined, { numeric: true }));
        return json(res, { entries });
      }
      if (url.pathname === '/api/files/read') {
        if (typeof input.path !== 'string' || !path.isAbsolute(input.path)) throw new Error('需要本地文件的绝对路径');
        const file = path.resolve(input.path);
        if (!/\.(md|txt|log|csv|json|ya?ml|toml|ini|xml|[cm]?[jt]sx?|py|c|cpp|h|hpp|sh|ps1|css|html|diff|patch)$/i.test(file)) throw new Error('此文件类型暂不支持文本预览');
        const stat = statSync(file);
        if (!stat.isFile()) throw new Error('该路径不是文件');
        if (stat.size > 5 * 1024 * 1024) throw new Error('文件超过 5 MB，请在本地编辑器中打开');
        return json(res, { text: readFileSync(file, 'utf8') });
      }
      if (url.pathname === '/api/sessions') return json(res, engine.createSession(input));
      if (url.pathname === '/api/history/refresh') return json(res, await engine.syncNativeHistory());
      if (url.pathname === '/api/history/archived') return json(res, await engine.syncArchivedHistory());
      if (url.pathname === '/api/history/open') return json(res, await engine.loadSessionHistory(input.sessionId));
      if (url.pathname === '/api/sessions/occupancy/refresh') return json(res, await engine.refreshOccupancy());
      if (url.pathname === '/api/sessions/archive') return json(res, await engine.archiveSession(input));
      if (url.pathname === '/api/sessions/unarchive') return json(res, await engine.unarchiveSession(input));
      if (url.pathname === '/api/sessions/rename') return json(res, await engine.renameSession(input));
      if (url.pathname === '/api/sessions/delete') return json(res, await engine.deleteSession(input));
      if (url.pathname === '/api/submit') return json(res, engine.submit(input));
      if (url.pathname === '/api/rate') return json(res, await engine.rateTask(input));
      if (url.pathname === '/api/branch') return json(res, await engine.branchTask(input));
      if (url.pathname === '/api/files/undo') return json(res, engine.undoTask(input));
      if (url.pathname === '/api/stop') { await engine.stop(); return json(res, { ok: true }); }
      if (url.pathname === '/api/compact') return json(res, await engine.compactSession(input.sessionId));
      if (url.pathname === '/api/account/refresh') return json(res, await engine.refreshAccount(true));
      if (url.pathname === '/api/account/login') return json(res, await engine.startAccountLogin(input.type, input.apiKey));
      if (url.pathname === '/api/account/login/cancel') return json(res, await engine.cancelAccountLogin());
      if (url.pathname === '/api/account/logout') return json(res, await engine.logoutAccount());
      if (url.pathname === '/api/usage/refresh') return json(res, await engine.refreshUsage());
      if (url.pathname === '/api/config/routing') return json(res, engine.updateRoutingConfig(input));
      if (url.pathname === '/api/providers/deepseek') return json(res, await engine.configureDeepseek(input));
      if (url.pathname === '/api/answer') { engine.answer(input.id, { approved: input.approved === true, answers: input.answers }); return json(res, { ok: true }); }
      if (url.pathname === '/api/mcp/reconnect') return json(res, await engine.connectMcp());
      if (url.pathname === '/api/shutdown') { json(res, { ok: true }); setImmediate(shutdown); return; }
      return json(res, { error: 'Not found' }, 404);
    }
    let file = path.resolve(root, 'out', '.' + decodeURIComponent(url.pathname));
    const base = path.resolve(root, 'out');
    if (file !== base && !file.startsWith(base + path.sep)) return json(res, { error: 'Not found' }, 404);
    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!existsSync(file)) return json(res, { error: '页面尚未构建，请运行启动脚本' }, 404);
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(readFileSync(file));
  } catch (e) {
    if (!res.headersSent) json(res, { error: e.message }, 400);
    else if (!res.writableEnded) res.end();
  }
});
server.listen(port, '127.0.0.1', () => { console.log(`Model Router: http://127.0.0.1:${port}`); engine.initialize().catch(e => { engine.status = 'error'; engine.error = e.message; engine.changed(); }); });
server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `端口 ${port} 已使用` : e.message); engine.close(); process.exit(1); });
function shutdown() {
  engine.close(); for (const c of clients) c.end(); server.close();
  setTimeout(() => process.exit(), 1800).unref();
}
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, shutdown);
