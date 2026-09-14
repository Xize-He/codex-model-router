export class McpClient {
  constructor({ url, tokenEnv }) { this.url = url; this.tokenEnv = tokenEnv; this.seq = 0; this.session = null; this.version = '2025-03-26'; this.tools = []; }
  async send(method, params = {}, { signal, notification = false } = {}) {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    const token = process.env[this.tokenEnv];
    if (token) headers.Authorization = `Bearer ${token}`;
    if (this.session) headers['Mcp-Session-Id'] = this.session;
    if (method !== 'initialize') headers['MCP-Protocol-Version'] = this.version;
    const id = notification ? undefined : ++this.seq;
    const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(15000);
    const response = await fetch(this.url, { method: 'POST', headers, redirect: 'error', signal: combined,
      body: JSON.stringify({ jsonrpc: '2.0', ...(id !== undefined ? { id } : {}), method, params }) });
    if (!response.ok) throw new Error(response.status === 401 ? (this.tokenEnv ? `MCP 认证失败：请配置环境变量 ${this.tokenEnv}` : 'MCP 认证失败：该服务需要令牌环境变量') : `MCP HTTP ${response.status}`);
    if (response.headers.has('mcp-session-id')) this.session = response.headers.get('mcp-session-id');
    if (notification || response.status === 204) { await response.body?.cancel(); return {}; }
    let message;
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
      const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
      try {
        while (!message) {
          const { value, done } = await reader.read(); if (done) break;
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
          if (buffer.length > 2_000_000) throw new Error('MCP 响应超过大小限制');
          let end;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const event = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            const data = event.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
            if (!data) continue;
            const parsed = JSON.parse(data); if (parsed.id === id) { message = parsed; break; }
          }
        }
      } finally { await reader.cancel().catch(() => {}); }
    } else { message = await response.json(); }
    if (!message || message.id !== id) throw new Error('MCP 未返回对应的请求结果');
    if (message.error) throw new Error(message.error.message || 'MCP 调用失败');
    return message.result;
  }
  async connect() {
    this.session = null;
    const result = await this.send('initialize', { protocolVersion: this.version, capabilities: {}, clientInfo: { name: 'local-model-router', version: '0.3.0' } });
    this.version = result.protocolVersion; this.info = result.serverInfo;
    await this.send('notifications/initialized', {}, { notification: true });
    this.tools = []; let cursor; const seen = new Set();
    do {
      const page = await this.send('tools/list', cursor ? { cursor } : {});
      this.tools.push(...(page.tools || [])); cursor = page.nextCursor;
      if (cursor && seen.has(cursor)) throw new Error('MCP 分页游标重复');
      seen.add(cursor);
    } while (cursor);
    return { name: this.info.name, version: this.info.version, tools: this.tools.map(t => ({ name: t.name, description: t.description, readOnly: t.annotations?.readOnlyHint === true })) };
  }
  call(name, args, signal) {
    if (!this.tools.some(t => t.name === name)) throw new Error('未知 MCP 工具');
    return this.send('tools/call', { name, arguments: args }, { signal });
  }
  dynamicTools() { return this.tools.map(t => ({ type: 'function', name: t.name, description: t.description || t.name, inputSchema: t.inputSchema, deferLoading: false })); }
}

const safeName = value => String(value).replace(/[^a-zA-Z0-9_-]/g, '_');

export class McpRegistry {
  constructor(servers = []) {
    this.entries = servers.map(config => ({
      config,
      client: new McpClient(config),
      status: { id: config.id, configuredName: config.name, url: config.url, tokenEnv: config.tokenEnv || '', enabled: config.enabled !== false, connected: false, tools: [], error: null },
    }));
    this.routes = new Map();
    this.legacyRoutes = new Map();
  }
  async connectAll() {
    this.routes.clear();
    this.legacyRoutes.clear();
    await Promise.all(this.entries.map(async entry => {
      const { config, client } = entry;
      if (config.enabled === false) {
        entry.status = { ...entry.status, connected: false, tools: [], error: null };
        return;
      }
      try {
        const info = await client.connect();
        entry.status = { ...entry.status, connected: true, name: info.name || config.name, version: info.version, tools: info.tools, error: null };
        for (const tool of client.tools) {
          // Codex reserves the `mcp__` prefix for tools loaded by its native MCP
          // subsystem. These tools are bridged through dynamicTools, so give them
          // an application-owned prefix instead.
          let alias = `router_mcp__${safeName(config.id)}__${safeName(tool.name)}`;
          let suffix = 2; const base = alias;
          while (this.routes.has(alias)) alias = `${base}_${suffix++}`;
          const route = { entry, tool, originalName: tool.name };
          this.routes.set(alias, route);
          if (!this.legacyRoutes.has(tool.name)) this.legacyRoutes.set(tool.name, route);
          else this.legacyRoutes.set(tool.name, null);
        }
      } catch (error) {
        entry.status = { ...entry.status, connected: false, tools: [], error: error.message };
      }
    }));
    return this.statuses();
  }
  statuses() { return this.entries.map(entry => ({ ...entry.status })); }
  connectedIds() { return this.entries.filter(entry => entry.status.connected).map(entry => entry.config.id); }
  dynamicTools() {
    return [...this.routes].map(([name, route]) => ({
      type: 'function', name,
      description: `[${route.entry.status.name || route.entry.config.name}] ${route.tool.description || route.originalName}`,
      inputSchema: route.tool.inputSchema, deferLoading: false,
    }));
  }
  resolve(name) { return this.routes.get(name) || this.legacyRoutes.get(name); }
  call(name, args, signal) {
    const route = this.resolve(name);
    if (!route) throw new Error('未知或未连接的 MCP 工具');
    return route.entry.client.call(route.originalName, args, signal);
  }
}
