import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Engine } from '../server/engine.mjs';
import { checkDeepseekKey, deepseekSettings, DEEPSEEK_MODEL, DEEPSEEK_PROVIDER } from '../server/deepseek.mjs';

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
  return { e, s: e.createSession(), calls };
}
async function finish(e) {
  for (let i = 0; e.active && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(e.active, null);
}
test('manual DeepSeek executes through its provider, persists binding and resumes without classifying', async () => {
  const { e, s, calls } = fixture();
  const first = e.submit({ sessionId: s.id, prompt: 'test', model: DEEPSEEK_MODEL, effort: 'low', webSearchMode: 'enabled' });
  await finish(e);
  assert.equal(first.status, 'completed');
  const start = calls.find(c => c.method === 'thread/start').params;
  assert.equal(start.modelProvider, DEEPSEEK_PROVIDER);
  assert.equal(start.model, DEEPSEEK_MODEL);
  assert.equal(start.config.web_search, 'disabled');
  assert.equal(start.approvalsReviewer, 'user');
  assert.equal(start.sandbox, 'workspace-write');
  assert.equal(calls.find(c => c.method === 'execution').params.effort, 'low');
  assert.equal(s.modelProvider, DEEPSEEK_PROVIDER);
  assert.doesNotMatch(JSON.stringify(e.publicState()), /test-only-secret/);
  assert.doesNotMatch(readFileSync(e.historyPath, 'utf8'), /test-only-secret/);
  s.loaded = false;
  e.submit({ sessionId: s.id, prompt: 'continue', model: DEEPSEEK_MODEL });
  await finish(e);
  assert.equal(calls.find(c => c.method === 'thread/resume').params.modelProvider, DEEPSEEK_PROVIDER);
  assert.equal(e.models.some(m => m.model === DEEPSEEK_MODEL), false);
  assert.equal(e.publicState().models.find(m => m.model === DEEPSEEK_MODEL).manualOnly, true);
});
test('missing credentials and cross-provider continuations are rejected before execution', () => {
  const { e, s, calls } = fixture();
  e.deepseekKey = '';
  assert.throws(() => e.submit({ sessionId: s.id, prompt: 'test', model: DEEPSEEK_MODEL }), /API Key/);
  e.deepseekKey = 'test-only-secret'; s.threadId = 'existing'; s.modelProvider = 'openai';
  assert.throws(() => e.submit({ sessionId: s.id, prompt: 'test', model: DEEPSEEK_MODEL }), /新建对话/);
  s.modelProvider = DEEPSEEK_PROVIDER;
  assert.throws(() => e.submit({ sessionId: s.id, prompt: 'test', model: 'auto' }), /新建对话/);
  assert.deepEqual(calls, []); assert.equal(s.tasks.length, 0);
});
test('key check uses fixed HTTPS endpoint, refuses redirects and never echoes remote errors', async () => {
  await checkDeepseekKey('test-only-secret', async (url, options) => {
    assert.equal(url, 'https://api.deepseek.com/models'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer test-only-secret');
    return { ok: true, json: async () => ({ data: [{ id: DEEPSEEK_MODEL }] }) };
  });
  await assert.rejects(checkDeepseekKey('test-only-secret', async () => ({ ok: false, status: 401, json: async () => ({ error: 'test-only-secret' }) })), /^Error: DeepSeek 连接检测失败（HTTP 401）$/);
  await assert.rejects(checkDeepseekKey('test-only-secret', async () => ({ ok: true, json: async () => ({ data: [] }) })), /未返回/);
  assert.doesNotMatch(JSON.stringify(deepseekSettings()), /test-only-secret/);
});
