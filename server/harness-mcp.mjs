import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';

// Expose existing MCP connections through a per-task loopback bridge. Remote
// credentials stay in McpRegistry, and write calls retain the UI approval gate.
export async function harnessMcpBridge(engine, ctx) {
  const tools = engine.mcp.dynamicTools();
  if (!tools.length) return { servers: [], close() {} };
  const token = randomBytes(32).toString('hex');
  const server = http.createServer(async (req, res) => {
    const auth = req.headers.authorization || '';
    const expected = `Bearer ${token}`;
    const reply = (value, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (Buffer.byteLength(auth) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(auth), Buffer.from(expected)) || req.method !== 'POST' || req.url !== '/mcp') return reply({}, 403);
    let message;
    try {
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 2_000_000) throw new Error('oversize'); }
      message = JSON.parse(body);
      if (message.id === undefined) { res.writeHead(202); res.end(); return; }
      if (ctx.controller.signal.aborted || engine.active !== ctx) throw new Error('stopped');
      let result;
      if (message.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'model-router-tools', version: '1' } };
      else if (message.method === 'ping') result = {};
      else if (message.method === 'tools/list') result = { tools: tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) };
      else if (message.method === 'tools/call') {
        const { name, arguments: args = {} } = message.params || {};
        const route = engine.mcp.resolve(name);
        if (!route || !tools.some(t => t.name === name)) throw new Error('unknown');
        if (route.tool.annotations?.readOnlyHint !== true) {
          const answer = await engine.ask(ctx, 'mcp', 'Harness 请求使用 MCP 写入工具', { server: route.entry.status.name || route.entry.config.name, tool: route.originalName, arguments: args });
          if (!answer.approved || ctx.controller.signal.aborted) return reply({ jsonrpc: '2.0', id: message.id, result: { isError: true, content: [{ type: 'text', text: '用户拒绝或任务已停止，未执行工具。' }] } });
        }
        try { result = await engine.mcp.call(name, args, ctx.controller.signal); }
        catch { result = { isError: true, content: [{ type: 'text', text: 'MCP 调用失败或已取消。不要自动重试写入操作。' }] }; }
      } else throw new Error('unsupported');
      reply({ jsonrpc: '2.0', id: message.id, result });
    } catch { reply({ jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32603, message: 'MCP request unavailable' } }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { servers: [{ type: 'http', name: 'router-tools', url: `http://127.0.0.1:${server.address().port}/mcp`, headers: [{ name: 'Authorization', value: `Bearer ${token}` }] }],
    close() { server.closeAllConnections(); server.close(); } };
}
