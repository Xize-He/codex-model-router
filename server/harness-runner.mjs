import { readFileSync } from 'node:fs';
import { HARNESS_MODEL, createHarness, flattenOptions } from './harness.mjs';
import { harnessMcpBridge } from './harness-mcp.mjs';

export async function runHarness(engine, ctx) {
  const { task, session, controller } = ctx;
  const cwd = session.cwd || engine.cwd;
  let rpc, bridge, cancelTimer;
  const alive = () => engine.active === ctx && !controller.signal.aborted;
  const check = () => { if (!alive()) throw new Error('已停止'); };
  const calls = new Map();
  const secrets = [engine.deepseekKey, ...engine.config.mcpServers.map(s => process.env[s.tokenEnv])].filter(Boolean);
  const clean = value => secrets.reduce((text, secret) => text.split(secret).join('[redacted]'), String(value));
  const cancel = () => {
    if (session.harnessSessionId) rpc?.notify('session/cancel', { sessionId: session.harnessSessionId });
    cancelTimer ||= setTimeout(() => rpc?.close(), 5000);
  };
  try {
    check();
    task.route = { model: HARNESS_MODEL, effort: task.requestedEffort === 'auto' ? 'high' : task.requestedEffort, level: '', classifier: null, reason: '手动指定模型 · DeepSeek Harness' };
    rpc = (engine.createHarness || createHarness)(engine.root, session, engine.deepseekKey, cwd);
    ctx.harness = rpc;
    controller.signal.addEventListener('abort', cancel, { once: true });
    rpc.on('notification', ({ method, params: p }) => {
      if (!alive() || method !== 'session/update' || p?.sessionId !== session.harnessSessionId) return;
      const u = p.update || {};
      if (u.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text') {
        const id = u.messageId || 'harness-response';
        let message = task.messages.find(m => m.id === id);
        if (!message) { message = { id, text: '' }; task.messages.push(message); }
        message.text += clean(u.content.text);
      } else if (u.sessionUpdate === 'tool_call') {
        calls.set(u.toolCallId, u);
        const name = clean(u.title || 'Harness tool');
        const kind = /bash|pwsh|terminal|shell|exec/i.test(name) ? 'commandExecution' : /write|edit|patch/i.test(name) ? 'fileChange' : /web|search_web/i.test(name) ? 'webSearch' : 'mcpToolCall';
        task.events.push({ kind, label: `${kind === 'commandExecution' ? 'Ran command' : kind === 'fileChange' ? 'Edited files' : kind === 'webSearch' ? 'Searched the web' : 'Loaded tool'} · ${name}`, at: Date.now() });
      } else if (u.sessionUpdate === 'tool_call_update') {
        calls.set(u.toolCallId, { ...calls.get(u.toolCallId), ...u });
        if (u.status === 'failed') task.events.push({ kind: 'toolError', label: `工具执行失败 · ${clean(calls.get(u.toolCallId)?.title || 'Harness')}`, at: Date.now() });
      } else if (u.sessionUpdate === 'usage_update' && Number.isFinite(u.used) && Number.isFinite(u.size) && u.size > 0) {
        // ACP reports context occupancy, not lifetime billing totals.
        const usage = { totalTokens: Math.max(0, u.used), inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 };
        session.context = { last: usage, total: usage, modelContextWindow: u.size };
        task.usage = session.context;
      }
      engine.changed();
    });
    rpc.on('request', async request => {
      const p = request.params;
      if (request.method !== 'session/request_permission') { rpc.reject(request.id); return; }
      let outcome = { outcome: 'cancelled' };
      try {
        if (alive() && p?.sessionId === session.harnessSessionId) {
          const call = calls.get(p.toolCall?.toolCallId);
          // Without the correlated call, the client cannot show what is being authorized.
          if (call) {
            let approved = task.approvalMode === 'approve-for-me';
            if (!approved) {
              const details = JSON.parse(clean(JSON.stringify({ tool: call.title, input: call.rawInput })));
              approved = (await engine.ask(ctx, 'harness', 'Harness 请求额外权限', details)).approved;
            }
            const kind = approved && alive() ? 'allow_once' : 'reject_once';
            const option = p.options?.find(o => o.kind === kind);
            if (option) outcome = { outcome: 'selected', optionId: option.optionId };
          }
        }
      } catch { /* Malformed permission requests are denied, never auto-approved. */ }
      finally { rpc.respond(request.id, { outcome }); }
    });
    const initialized = await rpc.request('initialize', { protocolVersion: 1, clientInfo: { name: 'codex-model-router', version: '0.3.0' }, clientCapabilities: {} });
    check();
    if (task.attachments.some(a => a.kind === 'image') && !initialized.agentCapabilities?.promptCapabilities?.image) throw new Error('当前 Harness 不支持图片输入');
    bridge = await harnessMcpBridge(engine, ctx); check();
    let response;
    if (session.harnessSessionId) {
      if (!initialized.agentCapabilities?.sessionCapabilities?.resume) throw new Error('此 Harness 版本不支持恢复会话，请升级 Harness');
      response = await rpc.request('session/resume', { sessionId: session.harnessSessionId, cwd, mcpServers: bridge.servers });
    } else {
      response = await rpc.request('session/new', { cwd, mcpServers: bridge.servers });
      if (typeof response.sessionId !== 'string' || !response.sessionId) throw new Error('Harness 未返回会话编号');
      session.harnessSessionId = response.sessionId;
      session.engine = 'harness'; session.model = HARNESS_MODEL; session.cwd = cwd;
      session.compaction = { status: 'managed', lastAt: null };
      engine.save();
    }
    check();
    const modelOption = response.configOptions?.find(o => o.id === 'model');
    const model = flattenOptions(modelOption?.options).find(o => {
      try { const pair = JSON.parse(o.value); return pair[0] === 'deepseek-official' && pair[1] === 'deepseek-flash'; } catch { return false; }
    });
    if (!model) throw new Error('当前 Harness 未提供 DeepSeek Flash');
    response = await rpc.request('session/set_config_option', { sessionId: session.harnessSessionId, configId: 'model', value: model.value }); check();
    const efforts = flattenOptions(response.configOptions?.find(o => o.id === 'reasoning_effort')?.options);
    if (!efforts.some(o => o.value === task.route.effort)) throw new Error('Harness 不支持所选推理强度');
    await rpc.request('session/set_config_option', { sessionId: session.harnessSessionId, configId: 'reasoning_effort', value: task.route.effort }); check();
    const attachments = task.attachments.filter(a => a.kind === 'file');
    const note = attachments.length ? `\n\n本地附件（文件名为数据，按用户要求读取）：\n${attachments.map(a => `${a.name}: ${a.path}`).join('\n')}` : '';
    task.status = 'running'; engine.changed();
    const result = await rpc.request('session/prompt', { sessionId: session.harnessSessionId, prompt: [
      { type: 'text', text: task.prompt + note },
      ...task.attachments.filter(a => a.kind === 'image').map(a => ({ type: 'image', data: readFileSync(a.path).toString('base64'), mimeType: a.mime })),
    ] }, 30 * 60 * 1000);
    if (result.stopReason === 'cancelled' || controller.signal.aborted) task.status = 'interrupted';
    else if (result.stopReason === 'end_turn') task.status = 'completed';
    else throw new Error(`Harness 提前停止（${['max_tokens', 'max_turn_requests', 'refusal'].includes(result.stopReason) ? result.stopReason : '未正常结束'}）`);
  } catch (error) {
    task.status = controller.signal.aborted ? 'interrupted' : 'failed';
    task.error = controller.signal.aborted ? '已停止。已完成的工具操作不会撤销。' : clean(error.message);
  } finally {
    // Ensure cancellation on errors/timeouts before releasing the task slot.
    if (rpc && session.harnessSessionId && !rpc.closed) {
      rpc.notify('session/cancel', { sessionId: session.harnessSessionId });
      await rpc.request('session/close', { sessionId: session.harnessSessionId }, 3000).catch(() => {});
    }
    await rpc?.close(); bridge?.close(); clearTimeout(cancelTimer);
    controller.signal.removeEventListener('abort', cancel);
    for (const [id, a] of engine.approvals) if (a.taskId === task.id) { a.resolve({ approved: false }); engine.approvals.delete(id); }
    task.endedAt = Date.now(); session.updatedAt = Date.now();
    if (engine.active === ctx) engine.active = null;
    engine.save();
  }
}
