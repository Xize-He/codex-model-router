import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Engine } from '../server/engine.mjs';
import { HARNESS_MODEL, harnessEnvironment } from '../server/harness.mjs';
import { harnessMcpBridge } from '../server/harness-mcp.mjs';

const options = [
  { id: 'model', options: [{ group: 'deepseek', options: [{ value: '["deepseek-official","deepseek-flash"]' }] }] },
  { id: 'reasoning_effort', options: ['low', 'high', 'max'].map(value => ({ value })) },
];
const pause = () => new Promise(r => setTimeout(r, 5));
async function until(fn) { for (let i = 0; i < 200 && !fn(); i++) await pause(); assert.ok(fn()); }
function fixture(handlers = {}) {
  mkdirSync('work/unit-tests', { recursive: true });
  const config = { mcpServers: [], routes: { simple: { model: 'gpt-test', effort: 'low' } } };
  const e = new Engine(mkdtempSync(path.resolve('work/unit-tests/harness-')), config);
  e.status = 'error'; e.deepseekKey = 'test-private-key';
  const calls = [], instances = [];
  e.rpc = { request() { throw new Error('Harness must never call Codex'); } };
  e.createHarness = () => {
    const rpc = new EventEmitter();
    rpc.request = async (method, params) => {
      calls.push({ method, params });
      if (handlers[method]) return handlers[method](rpc, params);
      if (method === 'initialize') return { agentCapabilities: { sessionCapabilities: { resume: {} }, promptCapabilities: { image: true } } };
      if (method === 'session/new') return { sessionId: 'h-session', configOptions: options };
      if (method === 'session/prompt') {
        rpc.emit('notification', { method: 'session/update', params: { sessionId: 'wrong', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'wrong response' } } } });
        rpc.emit('notification', { method: 'session/update', params: { sessionId: 'h-session', update: { sessionUpdate: 'agent_message_chunk', messageId: 'm', content: { type: 'text', text: 'hello test-private-key' } } } });
        rpc.emit('notification', { method: 'session/update', params: { sessionId: 'h-session', update: { sessionUpdate: 'usage_update', used: 345, size: 10000 } } });
        return { stopReason: 'end_turn' };
      }
      return { configOptions: options };
    };
    rpc.notify = (method, params) => calls.push({ method, params });
    rpc.respond = (id, result) => { calls.push({ method: 'response', id, result }); handlers.response?.(result); };
    rpc.reject = () => {};
    rpc.close = () => { rpc.closed = true; };
    instances.push(rpc); return rpc;
  };
  return { e, config, s: e.createSession({ kind: 'deepseek-harness' }), calls, instances };
}
test('Harness runs independently of Codex, resumes its own session and never exposes credentials', async () => {
  const { e, s, calls, config } = fixture();
  const task = e.submit({ sessionId: s.id, prompt: 'hello', model: HARNESS_MODEL, effort: 'low' });
  await until(() => !e.active);
  assert.equal(task.status, 'completed'); assert.equal(s.threadId, null); assert.equal(s.engine, 'harness');
  assert.equal(task.route.effort, 'low'); assert.equal(task.route.classifier, null); assert.equal(task.route.level, '');
  assert.equal(task.messages[0].text, 'hello [redacted]'); assert.equal(task.messages.length, 1);
  assert.equal(s.context.last.totalTokens, 345); assert.equal(s.context.modelContextWindow, 10000);
  assert.doesNotMatch(JSON.stringify(e.publicState()), /test-private-key/);
  assert.doesNotMatch(readFileSync(e.historyPath, 'utf8'), /test-private-key/);
  const restored = new Engine(e.root, config); restored.status = 'error'; restored.deepseekKey = e.deepseekKey; restored.createHarness = e.createHarness;
  restored.submit({ sessionId: s.id, prompt: 'continue', model: HARNESS_MODEL, effort: 'max' });
  await until(() => !restored.active);
  assert.equal(calls.filter(c => c.method === 'session/new').length, 1);
  assert.equal(calls.find(c => c.method === 'session/resume').params.sessionId, 'h-session');
  restored.status = 'ready';
  assert.throws(() => restored.submit({ sessionId: s.id, prompt: 'switch', model: 'auto' }), /另一执行引擎/);
  s.threadId = 'native'; assert.throws(() => e.submit({ sessionId: s.id, prompt: 'switch', model: HARNESS_MODEL }), /另一执行引擎/);
});
test('stop during Harness startup prevents a prompt and clears the task slot', async () => {
  let release;
  const { e, s, calls } = fixture({ initialize: () => new Promise(r => { release = r; }) });
  const task = e.submit({ sessionId: s.id, prompt: 'hello', model: HARNESS_MODEL });
  await e.stop(); release({}); await until(() => !e.active);
  assert.equal(task.status, 'interrupted'); assert.equal(calls.some(c => c.method === 'session/prompt'), false);
});
test('Harness permission approval is explicit, one-shot, and rejects unknown calls', async () => {
  let resolvePrompt;
  const { e, s, instances, calls } = fixture({ 'session/prompt': rpc => new Promise(r => {
    resolvePrompt = r;
    rpc.emit('notification', { method: 'session/update', params: { sessionId: 'h-session', update: { sessionUpdate: 'tool_call', toolCallId: 'call', title: 'pwsh', rawInput: { command: 'test' } } } });
    rpc.emit('request', { id: 1, method: 'session/request_permission', params: { sessionId: 'h-session', toolCall: { toolCallId: 'call' }, options: [{ kind: 'allow_once', optionId: 'yes' }, { kind: 'reject_once', optionId: 'no' }] } });
  }) });
  e.submit({ sessionId: s.id, prompt: 'hello', model: HARNESS_MODEL });
  await until(() => e.approvals.size === 1);
  assert.equal(e.active.task.status, 'waiting');
  e.answer([...e.approvals.keys()][0], { approved: false });
  await until(() => calls.some(c => c.method === 'response'));
  assert.equal(calls.find(c => c.method === 'response').result.outcome.optionId, 'no');
  instances[0].emit('request', { id: 2, method: 'session/request_permission', params: { sessionId: 'h-session', toolCall: { toolCallId: 'unknown' } } });
  await until(() => calls.some(c => c.id === 2));
  assert.equal(calls.find(c => c.id === 2).result.outcome.outcome, 'cancelled');
  await e.stop(); resolvePrompt({ stopReason: 'cancelled' }); await until(() => !e.active);
  assert.equal(e.approvals.size, 0); assert.ok(calls.some(c => c.method === 'session/cancel'));
});
test('Harness MCP bridge retains write approval and refuses unauthenticated clients', async () => {
  const { e, s } = fixture(); let invoked = 0;
  e.mcp = { dynamicTools: () => [{ name: 'write', inputSchema: { type: 'object' } }], resolve: () => ({ tool: {}, entry: { status: { name: 'memory' } }, originalName: 'write' }), call: () => { invoked++; return {}; } };
  const ctx = { session: s, task: { id: 'task' }, controller: new AbortController() }; e.active = ctx;
  const bridge = await harnessMcpBridge(e, ctx); const info = bridge.servers[0];
  try {
    assert.equal((await fetch(info.url,{method:'POST',body:'{}'})).status,403);
    const pending = fetch(info.url,{ method:'POST',headers:{'Content-Type':'application/json',Authorization:info.headers[0].value},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'write'}}) });
    await until(() => e.approvals.size === 1); assert.equal(invoked,0);
    e.answer([...e.approvals.keys()][0], { approved:false });
    assert.equal((await (await pending).json()).result.isError,true); assert.equal(invoked,0);
  } finally { bridge.close(); }
});
test('Harness inherits no unrelated provider secrets or permissive runtime settings', () => {
  const env = harnessEnvironment('/isolated', 'key', { PATH:'bin', OPENAI_API_KEY:'private', PERSONAL_MEMORY_TOKEN:'private', CODEX_HOME:'private', DSH_PERMISSION_MODE:'danger-full-access', NODE_OPTIONS:'--inspect', DEEPSEEK_BASE_URL:'https://unexpected.invalid' });
  assert.equal(env.PATH,'bin'); assert.equal(env.DSH_PERMISSION_MODE,'workspace-write');
  assert.equal(env.DEEPSEEK_API_KEY,'key'); assert.equal(env.DEEPSEEK_BASE_URL,undefined);
  assert.doesNotMatch(JSON.stringify(env),/private|--inspect|danger-full-access/);
});
