import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import { Engine } from '../server/engine.mjs';
import { sessionKind, defaultSessionModel, sessionAllowsModel } from '../lib/session-kind.mjs';

test('legacy native, Codex DeepSeek and Harness sessions keep their execution identity', () => {
  assert.equal(sessionKind({ threadId: 'native', model: 'gpt-test' }), 'gpt-codex');
  assert.equal(sessionKind({ threadId: 'ds', modelProvider: 'router_deepseek' }), 'deepseek-codex');
  assert.equal(sessionKind({ tasks: [{ route: { model: 'deepseek-flash' } }] }), 'deepseek-codex');
  assert.equal(sessionKind({ engine: 'harness', harnessSessionId: 'h' }), 'deepseek-harness');
  assert.equal(sessionKind({ tasks: [{ mode: 'deepseek-harness/flash' }] }), 'deepseek-harness');
});
test('creation persists the chosen type, keeps project cwd and rejects incompatible models before execution', () => {
  mkdirSync('work/unit-tests', { recursive: true });
  const root = mkdtempSync(path.resolve('work/unit-tests/session-kind-'));
  const config = { mcpServers: [], routes: { simple: { model: 'gpt-test', effort: 'low' } } };
  const e = new Engine(root, config); e.status = 'ready'; e.deepseekKey = 'test-only';
  e.models = [{ model: 'gpt-test', defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] }];
  e.createHarness = () => { throw new Error('Should not execute'); };
  e.run = async () => { throw new Error('Should not execute'); };
  assert.throws(() => e.createSession({ kind: 'unknown' }), /会话类型无效/);
  for (const kind of ['gpt-codex', 'deepseek-harness']) {
    const session = e.createSession({ kind, cwd: root });
    assert.equal(session.kind, kind); assert.equal(session.cwd, root);
    const wrong = kind === 'gpt-codex' ? 'deepseek-harness/flash' : 'auto';
    assert.throws(() => e.submit({ sessionId: session.id, prompt: 'test', model: wrong }), /不属于此会话类型/);
    assert.equal(session.tasks.length, 0); assert.equal(e.active, null);
    assert.equal(sessionAllowsModel(kind, defaultSessionModel(kind)), true);
  }
  const restored = new Engine(root, config);
  assert.deepEqual(restored.sessions.map(s => s.kind), e.sessions.map(s => s.kind));
  assert.equal(restored.publicState().sessions.length, 2);
  assert.deepEqual(restored.config.routes, config.routes, 'conversation type must not change global routing');
});
