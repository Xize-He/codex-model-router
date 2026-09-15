import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Engine, collectFileChanges, approvalSettings, webSearchSettings, parseRoute, pickRoute, buildRouteCatalog, mapNativeTurn, normalizeRateLimits, normalizeAccount } from '../server/engine.mjs';
import { McpClient, McpRegistry } from '../server/mcp.mjs';
import { loadRouterConfig, normalizeMcpServers } from '../server/config.mjs';
import { createPatch } from 'diff';

const config = { classifier: 'classifier', classifierEffort: 'medium', mcpUrl: 'http://127.0.0.1:1/mcp', mcpTokenEnv: 'ROUTER_TEST_TOKEN', routes: { instant: { model: 'small', effort: 'low' }, light: { model: 'small', effort: 'low' }, focused: { model: 'small', effort: 'low' }, standard: { model: 'big', effort: 'medium' }, agentic: { model: 'big', effort: 'medium' }, advanced: { model: 'big', effort: 'high' }, expert: { model: 'big', effort: 'high' }, extreme: { model: 'big', effort: 'high' } } };
const routerConfig = JSON.parse(readFileSync(new URL('../router.config.json', import.meta.url), 'utf8'));
const models = [{ model: 'small', displayName: 'Small', description: 'Fast model from the live catalog', defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] }, { model: 'big', displayName: 'Big', description: 'Capable model from the live catalog', defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'high' }] }, { model: 'classifier', displayName: 'Classifier', description: 'Classifier model', defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }] }];
function engine() { const dir = path.resolve('work/unit-tests'); mkdirSync(dir, { recursive: true }); const e = new Engine(mkdtempSync(path.join(dir, 'run-')), config); e.models = models; e.status = 'ready'; return e; }
test('dynamic route count and order survive a config reload', () => {
  const dir = mkdtempSync(path.join(path.resolve('work/unit-tests'), 'config-'));
  writeFileSync(path.join(dir, 'router.config.json'), JSON.stringify({
    routes: {
      first: { model: 'small', effort: 'low' },
      middle: { model: 'big', effort: 'medium' },
      last: { model: 'big', effort: 'high' },
    },
    routeLabels: { first: '第一档', middle: '第二档', last: '第三档' },
  }));
  writeFileSync(path.join(dir, 'router.config.local.json'), JSON.stringify({
    routeOrder: ['last', 'first'],
    routes: {
      first: { model: 'small', effort: 'low' },
      last: { model: 'big', effort: 'high' },
    },
    routeLabels: { last: '优先处理' },
    routeGuidance: { last: '需要更强推理。' },
  }));
  const loaded = loadRouterConfig(dir);
  assert.deepEqual(Object.keys(loaded.routes), ['last', 'first']);
  assert.equal(loaded.routeLabels.last, '优先处理');
  assert.equal(loaded.routeGuidance.last, '需要更强推理。');
  assert.equal(Object.hasOwn(loaded.routes, 'middle'), false);
});
test('Approve for me uses Codex auto-review without widening the sandbox', () => {
  assert.deepEqual(approvalSettings('ask'), { approvalPolicy: 'on-request', approvalsReviewer: 'user' });
  assert.deepEqual(approvalSettings('approve-for-me'), { approvalPolicy: 'on-request', approvalsReviewer: 'auto_review' });
});
test('web search choices map to Codex native search modes', () => {
  assert.deepEqual(webSearchSettings('auto'), { web_search: 'cached' });
  assert.deepEqual(webSearchSettings('enabled'), { web_search: 'live' });
  assert.deepEqual(webSearchSettings('disabled'), { web_search: 'disabled' });
  assert.throws(() => webSearchSettings('unknown'), /联网搜索设置无效/);
});
test('an existing conversation applies a changed web search mode before the next turn', async () => {
  const e = engine(), s = e.createSession({ webSearchMode: 'disabled' }), calls = [];
  s.threadId = 'existing-thread';
  s.loaded = true;
  s.appliedWebSearchMode = 'disabled';
  e.refreshUsage = async () => {}; e.syncNativeHistory = async () => {};
  e.rpc = { request: async (method, params) => { calls.push({ method, params }); return {}; } };
  e.runTurn = async () => { calls.push({ method: 'execution' }); };
  const task = e.submit({ sessionId: s.id, prompt: '搜索最新信息', model: 'small', webSearchMode: 'enabled' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(task.status, 'completed');
  assert.equal(s.webSearchMode, 'enabled');
  assert.equal(s.appliedWebSearchMode, 'enabled');
  assert.equal(calls[0].method, 'thread/resume');
  assert.equal(calls[0].params.config.web_search, 'live');
  assert.equal(calls[1].method, 'execution');
});
test('Approve for me is applied when a router thread is created', async () => {
  const e = engine(), s = e.createSession(), calls = [];
  e.refreshUsage = async () => {}; e.syncNativeHistory = async () => {};
  e.rpc = { request: async (method, params) => { calls.push({ method, params }); return method === 'thread/start' ? { thread: { id: 'thread' } } : {}; } };
  e.runTurn = async () => '';
  e.submit({ sessionId: s.id, prompt: '测试', model: 'small', approvalMode: 'approve-for-me' });
  await new Promise(resolve => setImmediate(resolve));
  const start = calls.find(call => call.method === 'thread/start');
  assert.equal(start.params.sandbox, 'workspace-write');
  assert.equal(start.params.approvalPolicy, 'on-request');
  assert.equal(start.params.approvalsReviewer, 'auto_review');
  assert.equal(start.params.config.web_search, 'cached');
});
test('writer conflicts fail before classification and can retry after release', async () => {
  const e = engine(), s = e.createSession(), calls = [];
  s.threadId = 'occupied-thread';
  e.refreshUsage = async () => {}; e.syncNativeHistory = async () => {};
  e.rpc = { request: async method => { calls.push(method); throw new Error('thread occupied-thread already has an active writer'); } };
  const task = e.submit({ sessionId: s.id, prompt: '问题', model: 'auto' });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['thread/resume']);
  assert.equal(task.status, 'failed'); assert.match(task.error, /新对话/); assert.equal(s.loaded, false); assert.equal(s.occupied, true);
  s.occupied = false; // A refresh probe observed that the other client released it.
  assert.equal(e.active, null); assert.equal(s.threadId, 'occupied-thread');
  e.rpc = { request: async method => { calls.push(method); return {}; } };
  e.runTurn = async () => { calls.push('execution'); };
  const retried = e.submit({ sessionId: s.id, prompt: '重试', model: 'small' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(retried.status, 'completed'); assert.equal(s.loaded, true); assert.equal(s.occupied, false);
  assert.deepEqual(calls, ['thread/resume', 'thread/resume', 'execution']);
});
test('occupied sessions are rechecked with an isolated probe and normal sessions are not claimed', async () => {
  const e = engine(), occupied = e.createSession(), normal = e.createSession(), calls = [];
  occupied.threadId = 'occupied-thread'; occupied.occupied = true; occupied.loaded = false;
  normal.threadId = 'normal-thread'; normal.loaded = false;
  e.createProbeRpc = () => ({
    initialize: async () => calls.push('initialize'),
    request: async (method, params) => { calls.push(`${method}:${params.threadId}`); throw new Error('already has an active writer'); },
    close: () => calls.push('close'),
  });
  const first = await e.refreshOccupancy();
  assert.deepEqual(first, { checked: 1, occupied: 1 });
  assert.equal(occupied.occupied, true);
  assert.equal(normal.occupied, undefined);
  assert.deepEqual(calls, ['initialize', 'thread/resume:occupied-thread', 'close']);
  e.createProbeRpc = () => ({ initialize: async () => {}, request: async () => ({ thread: { id: 'occupied-thread' } }), close: () => {} });
  const second = await e.refreshOccupancy();
  assert.deepEqual(second, { checked: 1, occupied: 0 });
  assert.equal(occupied.occupied, false);
  assert.equal(occupied.loaded, false);
});
test('classifier result is constrained and unavailable models do not silently fall back', () => {
  const levels = Object.keys(config.routes);
  assert.deepEqual(parseRoute('{"level":"instant","reason":"短问答"}', levels), { level: 'instant', reason: '短问答' });
  assert.throws(() => parseRoute('{"level":"admin","reason":"override"}', levels));
  assert.throws(() => pickRoute(config, models, 'light', 'missing'));
  assert.equal(pickRoute(config, models, 'expert', 'auto').effort, 'high');
  assert.equal(pickRoute(config, models, 'light', 'big').model, 'big');
  assert.throws(() => pickRoute(config, models, 'light', 'small', 'high'));
  const catalog = buildRouteCatalog(config, models);
  assert.equal(catalog.length, 8);
  assert.equal(catalog[0].description, 'Fast model from the live catalog');
  assert.equal(catalog[7].guidance.includes('极高难度'), true);
  const customCatalog = buildRouteCatalog({ ...config, routeLabels: { instant: '秒答' }, routeGuidance: { instant: '只处理一句话问题' } }, models);
  assert.equal(customCatalog[0].label, '秒答');
  assert.equal(customCatalog[0].guidance, '只处理一句话问题');
});
test('routing choices are validated and persisted as local overrides', () => {
  const e = engine();
  e.updateRoutingConfig({ classifier: 'big', classifierEffort: 'high' });
  e.updateRoutingConfig({ level: 'light', model: 'big', effort: 'medium' });
  assert.equal(e.config.classifier, 'big');
  assert.deepEqual(e.config.routes.light, { model: 'big', effort: 'medium' });
  const saved = JSON.parse(readFileSync(path.join(e.root, 'router.config.local.json'), 'utf8'));
  assert.equal(saved.classifierEffort, 'high');
  assert.deepEqual(saved.routes.light, { model: 'big', effort: 'medium' });
  assert.throws(() => e.updateRoutingConfig({ level: 'missing', model: 'big', effort: 'medium' }), /档位无效/);
  assert.throws(() => e.updateRoutingConfig({ level: 'light', model: 'small', effort: 'high' }), /不支持/);
  e.models = [];
  e.updateRoutingConfig({ level: 'light', label: '离线也可改名' });
  assert.equal(e.publicState().config.routeLabels.light, '离线也可改名');
  e.models = models;
  e.updateRoutingConfig({ tiers: [
    { level: 'simple', label: '简单', guidance: '无需工具的简单问题', model: 'small', effort: 'low' },
    { level: 'hard', label: '困难', guidance: '需要多步验证的困难问题', model: 'big', effort: 'high' },
  ] });
  assert.deepEqual(Object.keys(e.config.routes), ['simple', 'hard']);
  assert.equal(e.publicState().config.routeLabels.simple, '简单');
  assert.equal(e.publicState().config.routeGuidance.hard, '需要多步验证的困难问题');
  const resized = JSON.parse(readFileSync(path.join(e.root, 'router.config.local.json'), 'utf8'));
  assert.deepEqual(resized.routeOrder, ['simple', 'hard']);
  e.models = [];
  e.updateRoutingConfig({ routeOrder: ['hard', 'simple'] });
  assert.deepEqual(Object.keys(e.config.routes), ['hard', 'simple']);
  assert.deepEqual(Object.keys(e.config.routeLabels), ['hard', 'simple']);
  const reordered = JSON.parse(readFileSync(path.join(e.root, 'router.config.local.json'), 'utf8'));
  assert.deepEqual(reordered.routeOrder, ['hard', 'simple']);
  assert.throws(() => e.updateRoutingConfig({ routeOrder: ['hard', 'hard'] }), /顺序无效/);
  assert.throws(() => e.updateRoutingConfig({ routeOrder: ['hard'] }), /顺序无效/);
  e.models = models;
  assert.throws(() => e.updateRoutingConfig({ tiers: [{ level: 'only', label: '唯一', guidance: '不允许只有一档', model: 'small', effort: 'low' }] }), /2 到 12/);
  assert.throws(() => e.updateRoutingConfig({ tiers: [
    { level: 'constructor', label: '危险', guidance: '无效标识', model: 'small', effort: 'low' },
    { level: 'safe', label: '安全', guidance: '有效标识', model: 'small', effort: 'low' },
  ] }), /标识无效/);
});
test('default automatic routing uses the agreed L0-L4 model and effort profiles', () => {
  assert.equal(routerConfig.classifier, 'gpt-5.6-sol');
  assert.equal(routerConfig.classifierEffort, 'medium');
  assert.deepEqual(routerConfig.routes, {
    l0: { model: 'gpt-5.6-luna', effort: 'low' },
    l1: { model: 'gpt-5.6-terra', effort: 'medium' },
    l2: { model: 'gpt-5.6-sol', effort: 'medium' },
    l3: { model: 'gpt-6-astra', effort: 'high' },
    l4: { model: 'gpt-6-astra', effort: 'xhigh' },
  });
  assert.deepEqual(Object.keys(routerConfig.routes), ['l0', 'l1', 'l2', 'l3', 'l4']);
  const e = engine(); e.models = Object.values(routerConfig.routes).map(route => ({ model: route.model, supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'].map(reasoningEffort => ({ reasoningEffort })) }));
  e.updateRoutingConfig({ tiers: Object.entries(routerConfig.routes).map(([level, binding]) => ({ level, ...binding, label: routerConfig.routeLabels[level], guidance: routerConfig.routeGuidance[level] })) });
  writeFileSync(path.join(e.root, 'router.config.json'), JSON.stringify(routerConfig));
  const loaded = loadRouterConfig(e.root);
  assert.deepEqual(loaded.routes, routerConfig.routes);
  assert.deepEqual(loaded.routeLabels, routerConfig.routeLabels);
  assert.deepEqual(loaded.routeGuidance, routerConfig.routeGuidance);
});
test('native turns and multi-window account limits are normalized for the UI', () => {
  const task = mapNativeTurn({ id: 'turn', status: 'completed', startedAt: 10, completedAt: 12, error: null, items: [
    { type: 'userMessage', id: 'u', content: [{ type: 'text', text: '原生问题' }, { type: 'localImage', path: 'x' }] },
    { type: 'agentMessage', id: 'a', text: '原生回答' }, { type: 'contextCompaction', id: 'c' },
  ] }, { model: 'big', reasoningEffort: 'high', createdAt: 1, updatedAt: 12 });
  assert.equal(task.prompt, '原生问题\n[图片]'); assert.equal(task.messages[0].text, '原生回答'); assert.equal(task.events[0].label, '上下文已压缩');
  assert.equal(task.turnId, 'turn');
  const usage = normalizeRateLimits({ rateLimitsByLimitId: {
    codex: { limitId: 'codex', primary: { usedPercent: 27, windowDurationMins: 300, resetsAt: 100 }, secondary: null },
    other: { limitId: 'other', primary: { usedPercent: 140, windowDurationMins: 60, resetsAt: 200 }, secondary: null },
  }, rateLimitResetCredits: { availableCount: 2 } });
  assert.equal(usage.limits.length, 2); assert.equal(usage.limits[0].primary.usedPercent, 27); assert.equal(usage.limits[1].primary.usedPercent, 100); assert.equal(usage.resetCredits, 2);
});
test('account state exposes display fields without credentials', () => {
  assert.deepEqual(normalizeAccount({ account: { type: 'chatgpt', email: 'user@example.com', planType: 'plus', accessToken: 'secret' }, requiresOpenaiAuth: true }, 'Example User'), {
    loading: false, authenticated: true, requiresOpenaiAuth: true, type: 'chatgpt', displayName: 'Example User', avatarUrl: null, email: 'user@example.com', planType: 'plus', credentialSource: null, error: null, login: null,
  });
  assert.equal(normalizeAccount({ account: null, requiresOpenaiAuth: true }).authenticated, false);
  assert.equal(normalizeAccount({ account: null, requiresOpenaiAuth: false }).authenticated, true);
  assert.equal(normalizeAccount({ account: { type: 'chatgpt', picture: 'https://example.com/avatar.png' } }).avatarUrl, 'https://example.com/avatar.png');
  assert.equal(normalizeAccount({ account: { type: 'chatgpt', picture: 'javascript:alert(1)' } }).avatarUrl, null);
});
test('public state does not expose MCP endpoints, credentials or tool inventory', () => {
  const e = engine();
  e.config.mcpServers = [{ id: 'private', url: 'http://private.example/mcp', tokenEnv: 'PRIVATE_TOKEN' }];
  e.mcpStatuses = [{ id: 'private', configuredName: 'Private MCP', connected: true, enabled: true, url: 'http://private.example/mcp', tokenEnv: 'PRIVATE_TOKEN', tools: [{ name: 'secret_tool' }] }];
  const state = e.publicState();
  assert.deepEqual(state.mcpServers, [{ name: 'Private MCP', connected: true, enabled: true }]);
  assert.equal('mcpServers' in state.config, false);
  assert.doesNotMatch(JSON.stringify(state), /private\.example|PRIVATE_TOKEN|secret_tool/);
});
test('rating submits native feedback and branching forks through the selected turn', async () => {
  const e = engine(), s = e.createSession(), calls = [];
  s.threadId = 'source-thread'; s.loaded = true;
  s.tasks.push({ id: 'task-1', turnId: 'turn-1', prompt: '问题', status: 'completed', messages: [{ id: 'answer', text: '回答' }], events: [], startedAt: 10, endedAt: 20 });
  e.rpc = { request: async (method, params) => {
    calls.push({ method, params });
    if (method === 'feedback/upload') return { threadId: 'feedback-thread' };
    if (method === 'thread/fork') return { thread: { id: 'branch-thread' } };
    return {};
  } };
  await e.rateTask({ sessionId: s.id, taskId: 'task-1', rating: 'good' });
  assert.equal(s.tasks[0].rating, 'good');
  assert.deepEqual(calls[0], { method: 'feedback/upload', params: {
    classification: 'good_result', includeLogs: false, threadId: 'source-thread',
    reason: 'User rated this response positively.',
    tags: { source: 'local-model-router', rating: 'good', turn_id: 'turn-1' },
  } });
  const result = await e.branchTask({ sessionId: s.id, taskId: 'task-1' });
  assert.equal(result.threadId, 'branch-thread');
  assert.deepEqual(calls[1], { method: 'thread/fork', params: { threadId: 'source-thread', lastTurnId: 'turn-1' } });
  const branch = e.sessions.find(item => item.id === result.id);
  assert.equal(branch.tasks.length, 1); assert.equal(branch.tasks[0].turnId, 'turn-1'); assert.match(branch.title, /分支/);
});
test('sessions can be archived, restored and permanently deleted through Codex', async () => {
  const e = engine(), s = e.createSession(), calls = [];
  s.threadId = 'managed-thread';
  e.rpc = { request: async (method, params) => { calls.push({ method, params }); return {}; } };
  await e.archiveSession({ sessionId: s.id });
  assert.equal(s.archived, true); assert.equal(s.loaded, false);
  await e.unarchiveSession({ sessionId: s.id });
  assert.equal(s.archived, false);
  await assert.rejects(e.deleteSession({ sessionId: s.id }), /确认/);
  await e.deleteSession({ sessionId: s.id, confirmed: true });
  assert.equal(e.findSession(s.id), undefined);
  assert.deepEqual(calls, [
    { method: 'thread/archive', params: { threadId: 'managed-thread' } },
    { method: 'thread/unarchive', params: { threadId: 'managed-thread' } },
    { method: 'thread/delete', params: { threadId: 'managed-thread' } },
  ]);
});
test('sessions can be renamed locally and through Codex', async () => {
  const e = engine(), local = e.createSession(), native = e.createSession(), calls = [];
  native.threadId = 'managed-thread';
  e.rpc = { request: async (method, params) => { calls.push({ method, params }); return {}; } };
  await e.renameSession({ sessionId: local.id, title: '  本地新名称  ' });
  assert.equal(local.title, '本地新名称');
  await e.renameSession({ sessionId: native.id, title: '原生新名称' });
  assert.equal(native.title, '原生新名称');
  assert.deepEqual(calls, [
    { method: 'thread/name/set', params: { threadId: 'managed-thread', name: '原生新名称' } },
  ]);
  await assert.rejects(e.renameSession({ sessionId: native.id, title: '   ' }), /不能为空/);
});
test('archived native history is loaded separately and remains restorable', async () => {
  const e = engine();
  e.rpc = { request: async (method, params) => {
    assert.equal(method, 'thread/list'); assert.equal(params.archived, true);
    return { data: [{ id: 'archived-thread', ephemeral: false, parentThreadId: null, source: 'vscode', name: '已归档会话', preview: '', createdAt: 10, updatedAt: 20, cwd: 'C:/work', model: 'big', reasoningEffort: 'high', status: { type: 'notLoaded' } }], nextCursor: null };
  } };
  await e.syncArchivedHistory();
  assert.equal(e.history.archivedLoaded, true);
  assert.equal(e.nativeArchivedSessions[0].archived, true);
  assert.equal(e.allSessions()[0].title, '已归档会话');
});
test('native history is listed lazily and context or compaction updates without an active turn', async () => {
  const e = engine();
  e.rpc = { request: async (method) => {
    if (method === 'thread/list') return { data: [{ id: 'native-thread', ephemeral: false, parentThreadId: null, source: 'vscode', name: '原生标题', preview: '', createdAt: 10, updatedAt: 20, cwd: 'C:/work', model: 'big', reasoningEffort: 'high', status: { type: 'notLoaded' } }], nextCursor: null };
    if (method === 'thread/turns/list') return { data: [{ id: 'turn', status: 'completed', startedAt: 10, completedAt: 11, error: null, items: [{ type: 'userMessage', id: 'u', content: [{ type: 'text', text: '问题' }] }, { type: 'agentMessage', id: 'a', text: '回答' }] }], nextCursor: null };
    return {};
  } };
  await e.syncNativeHistory(); assert.equal(e.nativeSessions.length, 1); assert.equal(e.nativeSessions[0].tasks.length, 0);
  await e.loadSessionHistory(e.nativeSessions[0].id); assert.equal(e.nativeSessions[0].tasks[0].messages[0].text, '回答');
  e.onNotification({ method: 'thread/tokenUsage/updated', params: { threadId: 'native-thread', turnId: 't', tokenUsage: { last: { totalTokens: 123 }, total: { totalTokens: 456 }, modelContextWindow: 1000 } } });
  assert.equal(e.nativeSessions[0].context.last.totalTokens, 123);
  e.onNotification({ method: 'item/started', params: { threadId: 'native-thread', turnId: 't', item: { type: 'contextCompaction' } } }); assert.equal(e.nativeSessions[0].compaction.status, 'running');
  e.onNotification({ method: 'item/completed', params: { threadId: 'native-thread', turnId: 't', item: { type: 'contextCompaction' } } }); assert.equal(e.nativeSessions[0].compaction.status, 'completed');
});
test('MCP initializes, carries session/auth headers, and parses split SSE responses', async t => {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    const m = JSON.parse(body); calls.push({ m, headers: req.headers });
    if (m.method === 'initialize') { res.setHeader('Mcp-Session-Id', 'test-session'); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-03-26', serverInfo: { name: 'test', version: '1' }, capabilities: { tools: {} } } })); }
    else if (m.method === 'notifications/initialized') { res.writeHead(202); res.end(); }
    else if (m.method === 'tools/list') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ id: m.id, result: { tools: [{ name: 'memory_stats', inputSchema: { type: 'object' } }] } })); }
    else { res.setHeader('Content-Type', 'text/event-stream'); const data = `data: ${JSON.stringify({ id: m.id, result: { content: [{ type: 'text', text: '中文结果' }] } })}\n\n`; res.write(data.slice(0, 12)); setImmediate(() => res.end(data.slice(12))); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  process.env.ROUTER_TEST_TOKEN = 'test-only-token'; t.after(() => delete process.env.ROUTER_TEST_TOKEN);
  const client = new McpClient({ url: `http://127.0.0.1:${server.address().port}/mcp`, tokenEnv: 'ROUTER_TEST_TOKEN' });
  await client.connect(); const result = await client.call('memory_stats', {});
  assert.equal(result.content[0].text, '中文结果'); assert.equal(calls[2].headers['mcp-session-id'], 'test-session');
  assert.equal(calls[0].headers.authorization, 'Bearer test-only-token'); assert.throws(() => client.call('not-listed', {}));
});
test('MCP refuses redirects instead of forwarding credentials', async t => {
  const server = http.createServer((req, res) => { res.writeHead(302, { Location: 'http://127.0.0.1:1/private' }); res.end(); });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const c = new McpClient({ url: `http://127.0.0.1:${server.address().port}`, tokenEnv: 'ROUTER_TEST_TOKEN' });
  await assert.rejects(c.connect());
});
test('MCP configuration supports legacy migration and unique server ids', () => {
  assert.deepEqual(normalizeMcpServers({ mcpUrl: 'http://localhost/mcp', mcpTokenEnv: 'TOKEN' }), [
    { id: 'default', name: 'default', url: 'http://localhost/mcp', tokenEnv: 'TOKEN', enabled: true },
  ]);
  const servers = normalizeMcpServers({ mcpServers: [
    { id: 'Search Box', url: 'http://one/mcp' }, { id: 'search-box', url: 'http://two/mcp', enabled: false },
  ] });
  assert.equal(servers[0].id, 'search-box'); assert.equal(servers[1].id, 'search-box-2'); assert.equal(servers[1].enabled, false);
});
test('MCP registry namespaces tools and keeps healthy servers when another fails', async () => {
  const registry = new McpRegistry([
    { id: 'one', name: 'One', url: 'http://one/mcp', enabled: true },
    { id: 'two', name: 'Two', url: 'http://two/mcp', enabled: true },
  ]);
  registry.entries[0].client.connect = async function () { this.tools = [{ name: 'search', description: 'first', inputSchema: { type: 'object' } }]; return { name: 'Server One', version: '1', tools: [{ name: 'search' }] }; };
  registry.entries[1].client.connect = async () => { throw new Error('offline'); };
  const statuses = await registry.connectAll();
  assert.equal(statuses[0].connected, true); assert.equal(statuses[1].connected, false); assert.equal(statuses[1].error, 'offline');
  assert.equal(registry.dynamicTools()[0].name, 'router_mcp__one__search');
  assert.equal(registry.resolve('router_mcp__one__search').originalName, 'search');
});
test('rejecting MCP writes never calls the remote server; cancellation resolves approvals', async () => {
  const e = engine(), replies = []; let calls = 0;
  const ctx = { threadId: 'thread', turnId: 'turn', task: { id: 'task', events: [] }, controller: new AbortController() }; e.active = ctx;
  e.rpc = { respond: (id, result) => replies.push(result), reject: () => {}, request: async () => ({}) };
  e.mcp.routes.set('router_mcp__default__memory_delete', { tool: { name: 'memory_delete', annotations: { readOnlyHint: false } } }); e.mcp.call = async () => { calls++; };
  const pending = e.onRequest({ id: 7, method: 'item/tool/call', params: { threadId: 'thread', tool: 'router_mcp__default__memory_delete', arguments: { id: 'example' } } });
  assert.equal(e.approvals.size, 1); await e.stop(); await pending;
  assert.equal(e.approvals.size, 0); assert.equal(calls, 0); assert.equal(replies[0].success, false);
});
test('standard MCP readOnly hints bypass write approval for any server', async () => {
  const e = engine(); let calls = 0;
  e.active = { threadId: 'thread', task: { id: 'task', events: [] }, controller: new AbortController() };
  e.rpc = { respond: () => {}, reject: () => {} };
  e.mcp.routes.set('router_mcp__default__memory_stats', { tool: { name: 'memory_stats', annotations: { readOnlyHint: true } } });
  e.mcp.routes.set('router_mcp__default__unknown_tool', { tool: { name: 'unknown_tool', annotations: { readOnlyHint: true } } });
  e.mcp.call = async () => { calls++; return { content: [] }; };
  await e.onRequest({ id: 1, method: 'item/tool/call', params: { threadId: 'thread', tool: 'router_mcp__default__memory_stats', arguments: {} } });
  assert.equal(calls, 1); assert.equal(e.approvals.size, 0);
  await e.onRequest({ id: 2, method: 'item/tool/call', params: { threadId: 'thread', tool: 'router_mcp__default__unknown_tool', arguments: {} } });
  assert.equal(e.approvals.size, 0); assert.equal(calls, 2);
});
test('stop during thread creation prevents a turn from starting and overlapping submissions fail', async () => {
  const e = engine(), s = e.createSession(); let unblock, turns = 0;
  e.rpc = { request: async method => { if (method === 'thread/start') { await new Promise(r => unblock = r); return { thread: { id: 'thread' } }; } if (method === 'turn/start') turns++; return {}; } };
  const task = e.submit({ sessionId: s.id, prompt: 'test', model: 'small' });
  assert.throws(() => e.submit({ sessionId: s.id, prompt: 'duplicate', model: 'small' }));
  await e.stop(); unblock(); await new Promise(r => setImmediate(r));
  assert.equal(task.status, 'interrupted'); assert.equal(turns, 0); assert.equal(e.active, null);
});
test('late notifications from an older turn cannot complete the current turn', () => {
  const e = engine(); let done = false;
  e.waiters.set('thread', { ctx: { turnId: 'new', task: {} }, resolve: () => done = true });
  e.onNotification({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'old', status: 'completed' } } }); assert.equal(done, false);
});
test('file summaries exclude failed edits and deduplicate replayed notifications', () => {
  const edit = { id: 'edit', type: 'fileChange', status: 'completed', changes: [{ path: 'a.txt', kind: { type: 'add' }, diff: '+hello' }] };
  const rename = { id: 'rename', type: 'fileChange', status: 'completed', changes: [{ path: 'b.txt', kind: { type: 'update', move_path: 'c.txt' }, diff: '-old\n+new' }] };
  const failed = { ...edit, id: 'failed', status: 'failed', changes: [{ path: 'bad.txt', kind: { type: 'delete' } }] };
  const files = collectFileChanges([edit, edit, rename, failed, { ...failed, id: 'declined', status: 'declined' }]);
  assert.equal(files.length, 2); assert.deepEqual(files[0].diffs, ['+hello']); assert.equal(files[1].movePath, 'c.txt');
  assert.deepEqual(mapNativeTurn({ items: [edit, rename, failed], status: 'completed' }, {}).files, files);
  const e = engine(), task = { events: [] };
  e.waiters.set('thread', { ctx: { turnId: 'current', task }, resolve: () => {} });
  e.onNotification({ method: 'item/completed', params: { threadId: 'thread', turnId: 'old', item: edit } });
  assert.equal(task.files, undefined);
  e.onNotification({ method: 'item/completed', params: { threadId: 'thread', turnId: 'current', item: edit } });
  e.onNotification({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'current', status: 'completed', items: [edit, rename, failed] } } });
  assert.deepEqual(task.files, files);
});
test('completed turns expose usable undo while missing confirmation and active tasks block it', async () => {
  const e = engine(), s = e.createSession(), file = path.join(e.cwd, 'test.txt');
  writeFileSync(file, 'before\n');
  e.refreshUsage = async () => {}; e.syncNativeHistory = async () => {};
  e.rpc = { request: async method => method === 'thread/start' ? { thread: { id: 'thread' } } : {} };
  e.runTurn = async ctx => {
    writeFileSync(file, 'after\n');
    const item = { type: 'fileChange', id: 'edit', status: 'completed', changes: [{ path: file, kind: { type: 'update' }, diff: createPatch(file, 'before\n', 'after\n') }] };
    ctx.fileChangeItems = new Map([['edit', item]]); ctx.task.files = collectFileChanges([item]);
  };
  const task = e.submit({ sessionId: s.id, prompt: 'edit', model: 'small' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(task.undo.status, 'available');
  assert.throws(() => e.undoTask({ sessionId: s.id, taskId: task.id }), /确认/);
  e.active = {}; assert.throws(() => e.undoTask({ sessionId: s.id, taskId: task.id, confirmed: true }), /任务结束/); e.active = null;
  e.undoTask({ sessionId: s.id, taskId: task.id, confirmed: true });
  assert.equal(readFileSync(file, 'utf8'), 'before\n');
  assert.equal(task.undo.status, 'undone');
  assert.equal(JSON.parse(readFileSync(e.historyPath, 'utf8'))[0].tasks[0].undo.status, 'undone');
});
