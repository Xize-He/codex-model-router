import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Engine } from '../server/engine.mjs';
import { checkDeepseekKey, DEEPSEEK_MODEL } from '../server/deepseek.mjs';

function fixture() {
  mkdirSync('work/unit-tests', { recursive: true });
  const config = { classifier: 'worker', mcpServers: [], routes: { basic: { model: 'worker', effort: 'low' } } };
  const e = new Engine(mkdtempSync(path.resolve('work/unit-tests/deepseek-')), config);
  e.status = 'ready'; e.deepseekKey = 'test-only-secret';
  e.models = [{ model: 'worker', defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] }];
  e.refreshUsage = async () => {}; e.syncNativeHistory = async () => {};
  const calls = [];
  e.rpc = { request: async (method, params) => { calls.push({ method, params }); return { thread: { id: 'ds-thread' } }; } };
  e.runTurn = async (ctx, threadId, params, classifier) => { assert.equal(classifier, false); calls.push({ method: 'execution', params }); };
  return { e, s: e.createSession({ kind: 'gpt-codex' }), calls };
}
test('removed DeepSeek Codex cannot be created, selected or resumed', async () => {
  const { e, s, calls } = fixture();
  assert.throws(() => e.createSession({ kind: 'deepseek-codex' }), /会话类型无效/);
  assert.throws(() => e.submit({ sessionId: s.id, prompt: 'test', model: DEEPSEEK_MODEL }));
  assert.equal(e.publicState().models.some(m => m.model === DEEPSEEK_MODEL), false);
  s.kind = 'deepseek-codex'; s.modelProvider = 'router_deepseek'; s.threadId = 'retired-thread';
  assert.equal(e.findSession(s.id), undefined);
  assert.equal(e.publicState().sessions.some(item => item.id === s.id), false);
  assert.throws(() => e.submit({ sessionId: s.id, prompt: 'continue', model: 'auto' }), /对话不存在/);
  await assert.rejects(e.compactSession(s.id));
  assert.equal(s.tasks.length, 0); assert.deepEqual(calls, []);
});
test('Harness credential changes do not restart Codex or leak the key', async () => {
  const { e, s, calls } = fixture(); const originalFetch = globalThis.fetch;
  e.initialize = async () => { throw new Error('Must not restart Codex'); };
  s.loaded = true;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: [{ id: DEEPSEEK_MODEL }] }) });
  try { await e.configureDeepseek({ apiKey: 'replacement-test-secret' }); }
  finally { globalThis.fetch = originalFetch; }
  assert.equal(e.deepseekKey, 'replacement-test-secret'); assert.equal(s.loaded, true);
  assert.deepEqual(calls, []);
  assert.doesNotMatch(JSON.stringify(e.publicState()), /replacement-test-secret/);
  assert.doesNotMatch(readFileSync(e.historyPath, 'utf8'), /replacement-test-secret/);
});
test('key check uses fixed HTTPS endpoint, refuses redirects and never echoes remote errors', async () => {
  await checkDeepseekKey('test-only-secret', async (url, options) => {
    assert.equal(url, 'https://api.deepseek.com/models'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer test-only-secret');
    return { ok: true, json: async () => ({ data: [{ id: DEEPSEEK_MODEL }] }) };
  });
  await assert.rejects(checkDeepseekKey('test-only-secret', async () => ({ ok: false, status: 401, json: async () => ({ error: 'test-only-secret' }) })), /^Error: DeepSeek 连接检测失败（HTTP 401）$/);
  await assert.rejects(checkDeepseekKey('test-only-secret', async () => ({ ok: true, json: async () => ({ data: [] }) })), /未返回/);
});
