import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createPatch } from 'diff';
import { Engine, buildRouteCatalog } from '../server/engine.mjs';
import { loadRouterConfig } from '../server/config.mjs';
import { ESCALATION_TOOL, classificationTiers, parseClassification } from '../server/routing.mjs';

const config = {
  classifier: 'judge', classifierEffort: 'medium', mcpServers: [],
  routes: { basic: { model: 'worker', effort: 'low' }, complex: { model: 'expert', effort: 'medium' }, critical: { model: 'expert', effort: 'high' } },
  routeLabels: { basic: '常规', complex: '复杂', critical: '关键' },
  routeGuidance: { basic: '边界清晰的修改', complex: '跨系统耦合问题', critical: '关键系统决策' },
  routeEscalationGuidance: { basic: '发现共享协议状态涉及驱动与用户态时升级' },
};
const models = ['judge', 'worker', 'expert'].map(model => ({ model, displayName: model, description: 'Private provider catalog text', defaultReasoningEffort: 'medium', supportedReasoningEfforts: ['low', 'medium', 'high'].map(reasoningEffort => ({ reasoningEffort })) }));
const decision = { level: 'basic', reason: '初始范围清晰', confidence: 82, taskType: '局部修复', escalation: { targetLevel: 'complex', signals: ['发现跨内核与用户态的协议依赖'] } };
const request = { targetLevel: 'complex', reason: '发现跨层协议状态依赖', evidence: ['驱动与用户态共享序列号，异步重试可能导致重复写入'], handoff: '已经修改解析代码并完成局部测试；还需核对驱动状态机。不要重复已提交的写入。' };

function fixture(execute) {
  mkdirSync('work/unit-tests', { recursive: true });
  const e = new Engine(mkdtempSync(path.resolve('work/unit-tests/escalation-')), structuredClone(config));
  e.models = structuredClone(models); e.status = 'ready';
  e.refreshUsage = async () => {}; e.syncNativeHistory = async () => {};
  const s = e.createSession(), calls = [], replies = [], rejected = [], failures = [];
  let executionTurns = 0, seq = 0;
  const notify = (method, params) => e.onNotification({ method, params });
  e.rpc = {
    respond: (id, result) => replies.push({ id, ...result }), reject: (id, message) => rejected.push({ id, message }),
    request: async (method, params) => {
      calls.push({ method, params });
      if (method === 'thread/start') return { thread: { id: params.ephemeral ? 'classifier' : 'conversation' } };
      if (method === 'turn/start') {
        const turnId = `turn-${++seq}`, classifier = params.threadId === 'classifier';
        const n = classifier ? 0 : ++executionTurns;
        setImmediate(async () => {
          const base = { threadId: params.threadId, turnId };
          const complete = (status = 'completed', items = []) => notify('turn/completed', { ...base, turn: { id: turnId, status, items } });
          try {
            notify('turn/started', { ...base, turn: { id: turnId } });
            if (classifier) {
              notify('item/completed', { ...base, item: { type: 'agentMessage', id: 'classification', text: JSON.stringify(decision) } }); complete();
            } else await execute({ e, s, n, base, params, complete, notify, replies, rejected,
              tool: (args = request, override = {}) => e.onRequest({ id: ++seq, method: 'item/tool/call', params: { ...base, tool: ESCALATION_TOOL, arguments: args, ...override } }),
            });
          } catch (error) { failures.push(error); complete('failed'); }
        });
        return { turn: { id: turnId } };
      }
      return {};
    },
  };
  return { e, s, calls, replies, rejected, failures, executionTurns: () => executionTurns };
}
async function finished(f) {
  const deadline = Date.now() + 2000;
  while (f.e.active && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(f.e.active, null, 'task must finish');
  assert.deepEqual(f.failures, []);
}

test('classification input is independent of bindings and strict escalation plans are validated', () => {
  const tiers = classificationTiers(buildRouteCatalog(config, models));
  const changed = { ...config, routes: { basic: { model: 'new', effort: 'ultra' }, complex: {}, critical: {} } };
  assert.deepEqual(classificationTiers(buildRouteCatalog(changed, [])), tiers);
  assert.doesNotMatch(JSON.stringify(tiers), /worker|expert|judge|Private provider|supportedReasoning|effort/);
  assert.deepEqual(parseClassification(JSON.stringify(decision), Object.keys(config.routes)), decision);
  for (const invalid of [
    { ...decision, confidence: 101 }, { ...decision, confidence: '82' },
    { ...decision, escalation: { targetLevel: 'missing', signals: ['a'] } },
    { ...decision, escalation: { targetLevel: 'basic', signals: ['a'] } },
    { ...decision, escalation: { targetLevel: 'complex', signals: [] } },
  ]) assert.throws(() => parseClassification(JSON.stringify(invalid), Object.keys(config.routes)));
});

test('upgrade continues the same thread, preserves approvals, combines edits and undo, and survives reload', async () => {
  let file, firstTurnId;
  const f = fixture(async ({ e, s, n, base, complete, notify, tool, params }) => {
    file = path.join(e.cwd, 'state.txt');
    const before = n === 1 ? 'original\n' : 'first edit\n', after = n === 1 ? 'first edit\n' : 'second edit\n';
    writeFileSync(file, after);
    // Even if item ids repeat across turns, both patches must be retained.
    const item = { type: 'fileChange', id: 'edit', status: 'completed', changes: [{ path: file, kind: { type: 'update' }, diff: createPatch(file, before, after) }] };
    notify('item/completed', { ...base, item });
    notify('item/completed', { ...base, item: { type: 'agentMessage', id: `answer-${n}`, text: n === 1 ? '交接摘要' : '完成修改' } });
    if (n === 1) {
      assert.match(params.additionalContext['model-router/policy'].value, /发现共享协议状态涉及驱动与用户态时升级/);
      firstTurnId = base.turnId;
      await tool(); assert.equal(e.active.task.route.model, 'worker');
      assert.equal(e.active.task.status, 'escalating');
    } else {
      assert.equal(base.threadId, s.threadId); assert.equal(params.model, 'expert');
      assert.match(params.input[0].text, /不要重复/);
      assert.match(params.additionalContext['model-router/policy'].value, /"upgradesRemaining":0/);
      notify('turn/completed', { ...base, turn: { id: firstTurnId, status: 'failed' } });
      await tool({ ...request, targetLevel: 'critical' });
      assert.equal(f.replies.at(-1).success, false);
    }
    complete('completed', [item]);
  });
  const task = f.e.submit({ sessionId: f.s.id, prompt: '修复状态同步', model: 'auto', approvalMode: 'ask' });
  await finished(f);
  assert.equal(task.status, 'completed'); assert.equal(f.executionTurns(), 2);
  assert.equal(task.messages.length, 2); assert.equal(task.turnIds.length, 2);
  assert.equal(task.files.length, 1); assert.equal(task.files[0].diffs.length, 2);
  assert.equal(task.routeHistory.length, 1); assert.equal(task.routeHistory[0].from.model, 'worker');
  assert.equal(task.route.model, 'expert'); assert.equal(task.undo.status, 'available');
  const start = f.calls.find(call => call.method === 'thread/start' && !call.params.ephemeral);
  assert.equal(start.params.approvalsReviewer, 'user');
  assert.ok(start.params.dynamicTools.some(tool => tool.name === ESCALATION_TOOL));
  const classifierCall = f.calls.find(call => call.method === 'turn/start' && call.params.threadId === 'classifier');
  assert.deepEqual(JSON.parse(classifierCall.params.input[0].text).tiers, classificationTiers(buildRouteCatalog(config, models)));
  assert.deepEqual(classifierCall.params.outputSchema.required, ['level', 'reason', 'confidence', 'taskType', 'escalation']);
  const reloaded = new Engine(f.e.root, config);
  assert.equal(reloaded.sessions[0].routingToolVersion, 1);
  assert.deepEqual(reloaded.sessions[0].tasks[0].routeHistory, task.routeHistory);
  f.e.undoTask({ sessionId: f.s.id, taskId: task.id, confirmed: true });
  assert.equal(readFileSync(file, 'utf8'), 'original\n');
});

test('invalid, duplicate, stale, unavailable and image-incompatible upgrades are rejected', async () => {
  const f = fixture(async ({ e, tool, complete, replies, rejected, base, notify }) => {
    const reject = async (args, pattern) => { await tool(args); assert.equal(replies.at(-1).success, false); assert.match(replies.at(-1).contentItems[0].text, pattern); };
    await reject({ ...request, targetLevel: 'basic' }, /更高/);
    await reject({ ...request, targetLevel: 'missing' }, /更高/);
    await reject({ ...request, evidence: [] }, /证据/);
    await reject({ ...request, handoff: '' }, /交接/);
    notify('item/started', { ...base, item: { id: 'command', type: 'commandExecution', command: 'test' } });
    await reject(request, /等待/);
    notify('item/completed', { ...base, item: { id: 'command', type: 'commandExecution', status: 'completed' } });
    await tool(request, { turnId: 'stale' }); assert.equal(rejected.length, 1);
    e.models = e.models.filter(model => model.model !== 'expert');
    await reject(request, /不可用/);
    e.models = structuredClone(models);
    e.active.routingConfig.routes.complex = { model: 'worker', effort: 'low' };
    await reject(request, /相同/);
    e.active.routingConfig.routes.complex = { model: 'expert', effort: 'medium' };
    e.models.find(model => model.model === 'expert').inputModalities = ['text'];
    e.active.task.attachments = [{ kind: 'image' }];
    await reject(request, /图片/); e.active.task.attachments = [];
    await tool(); assert.equal(replies.at(-1).success, true);
    await reject(request, /最多/);
    e.onNotification({ method: 'error', params: { ...base, willRetry: false, error: { message: 'network unavailable' } } });
    complete('failed');
  });
  const task = f.e.submit({ sessionId: f.s.id, prompt: '测试', model: 'auto' });
  await finished(f); assert.equal(task.status, 'failed'); assert.equal(f.executionTurns(), 1);
});

test('user cancellation after acceptance never launches a continuation', async () => {
  const f = fixture(async ({ e, tool, complete }) => { await tool(); await e.stop(); complete('interrupted'); });
  const task = f.e.submit({ sessionId: f.s.id, prompt: '测试', model: 'auto' });
  await finished(f); assert.equal(task.status, 'interrupted'); assert.equal(f.executionTurns(), 1);
  assert.equal(task.routeHistory, undefined);
});

test('manual mode disables escalation and does not invoke the classifier', async () => {
  const f = fixture(async ({ tool, complete, params, replies }) => {
    assert.match(params.additionalContext['model-router/policy'].value, /disabled/);
    await tool(); assert.equal(replies.at(-1).success, false); complete();
  });
  const task = f.e.submit({ sessionId: f.s.id, prompt: '测试', model: 'worker', effort: 'low' });
  await finished(f); assert.equal(task.status, 'completed'); assert.equal(f.executionTurns(), 1);
  assert.equal(f.calls.some(call => call.params?.ephemeral), false);
});

test('existing conversations retain initial routing without pretending to retrofit dynamic tools', async () => {
  const f = fixture(async ({ e, tool, complete, replies }) => {
    assert.equal(e.active.task.escalationAvailable, false);
    await tool(); assert.equal(replies.at(-1).success, false); complete();
  });
  f.s.threadId = 'existing-thread'; f.s.loaded = false;
  const task = f.e.submit({ sessionId: f.s.id, prompt: '继续', model: 'auto' });
  await finished(f); assert.equal(task.status, 'completed'); assert.equal(f.executionTurns(), 1);
  assert.equal(f.calls[0].method, 'thread/resume');
  assert.equal(Object.hasOwn(f.calls[0].params, 'dynamicTools'), false);
});

test('editable escalation criteria survive save, reorder, tier replacement, clearing and restart', () => {
  const { e } = fixture(async () => {});
  writeFileSync(path.join(e.root, 'router.config.json'), JSON.stringify(config));
  const rule = '发现当前模块依赖多个状态机时才考虑升级';
  const result = e.updateRoutingConfig({ level: 'basic', escalationGuidance: rule });
  assert.equal(result.config.routeEscalationGuidance.basic, rule);
  assert.equal(e.publicState().config.routeEscalationGuidance.basic, rule);
  assert.equal(loadRouterConfig(e.root).routeEscalationGuidance.basic, rule);
  assert.equal(classificationTiers(buildRouteCatalog(e.config, e.models))[0].escalationGuidance, rule);
  e.updateRoutingConfig({ routeOrder: ['critical', 'basic', 'complex'] });
  assert.equal(e.config.routeEscalationGuidance.basic, rule);
  e.updateRoutingConfig({ tiers: buildRouteCatalog(e.config, e.models).filter(tier => tier.level !== 'complex').map(({ escalationGuidance: _escalationGuidance, ...legacyTier }) => legacyTier) });
  assert.equal(e.config.routeEscalationGuidance.basic, rule, 'older clients replacing tiers preserve omitted criteria');
  assert.equal(Object.hasOwn(e.config.routeEscalationGuidance, 'complex'), false);
  assert.throws(() => e.updateRoutingConfig({ level: 'basic', escalationGuidance: null }), /必须是文字/);
  e.updateRoutingConfig({ level: 'basic', escalationGuidance: '' });
  const reloaded = new Engine(e.root, loadRouterConfig(e.root));
  assert.equal(reloaded.config.routeEscalationGuidance.basic, '', 'cleared local criteria must override the default');
  assert.equal(reloaded.publicState().config.routeEscalationGuidance.basic, '');
});
