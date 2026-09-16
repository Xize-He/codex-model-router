import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { Engine } from '../server/engine.mjs';
import { HarnessRPC, HARNESS_MODEL, harnessLaunch, harnessRuntime, harnessHome } from '../server/harness.mjs';

// Optional real-runtime smoke test: all model responses come from loopback, no
// account, API credits, desktop profile, or real project files are involved.
test('real Harness executes a tool, persists and resumes context through ACP', { skip: process.env.RUN_HARNESS_TESTS !== '1', timeout: 90000 }, async () => {
  const runtime = harnessRuntime(process.cwd()); assert.ok(runtime, 'Run npm run harness:install first');
  const previous = process.env.ROUTER_HARNESS_BIN; process.env.ROUTER_HARNESS_BIN = runtime.bin;
  mkdirSync('work/unit-tests', { recursive: true });
  const root = mkdtempSync(path.resolve('work/unit-tests/harness-runtime-'));
  const config = { mcpServers: [], routes: { simple: { model: 'gpt-test', effort: 'low' } } };
  const requests = []; let mcpWrites = 0;
  const file = path.join(root, 'workspace', 'smoke.txt');
  const mock = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const data = JSON.parse(body); requests.push(data);
    if (requests.length === 5) return; // Leave a generation pending for cancellation.
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const emit = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', model: 'deepseek-flash', choices: [{ index: 0, delta, finish_reason }], usage: { prompt_tokens: 800, completion_tokens: 50, total_tokens: 850 } })}\n\n`);
    if (requests.length === 1) {
      emit({ role: 'assistant', reasoning_content: 'test', content: '', tool_calls: [{ index: 0, id: 'write1', type: 'function', function: { name: 'write', arguments: JSON.stringify({ file_path: file, content: 'Harness smoke OK\n' }) } }] });
      emit({}, 'tool_calls');
    } else if (requests.length === 3) {
      const name = data.tools.find(t => t.function.name.includes('memory_add'))?.function.name;
      assert.ok(name, 'Harness did not load the MCP bridge');
      emit({ role: 'assistant', reasoning_content: 'test', content: '', tool_calls: [{ index: 0, id: 'memory1', type: 'function', function: { name, arguments: JSON.stringify({ text: 'test' }) } }] });
      emit({}, 'tool_calls');
    } else { emit({ role: 'assistant', reasoning_content: 'test', content: 'Harness smoke OK' }); emit({}, 'stop'); }
    res.end('data: [DONE]\n\n');
  });
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  const setup = () => {
    const e = new Engine(root, config); e.deepseekKey = 'mock-key-only'; e.status = 'error';
    e.mcp = {
      dynamicTools: () => [{ name: 'router_mcp__sample__memory_add', description: 'Test memory tool', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }],
      resolve: () => ({ tool: {}, originalName: 'memory_add', entry: { status: { name: 'test-memory' } } }),
      call: () => { mcpWrites++; return { content: [{ type: 'text', text: 'unexpected write' }] }; },
    };
    e.createHarness = (r, s, key, cwd) => {
      const launch = harnessLaunch(r, s, key, cwd);
      return new HarnessRPC({ ...launch, env: { ...launch.env, DEEPSEEK_BASE_URL: `http://127.0.0.1:${mock.address().port}` } });
    };
    return e;
  };
  const finish = async e => { for (let i = 0; e.active && i < 600; i++) await new Promise(r => setTimeout(r, 50)); assert.equal(e.active, null, 'task did not stop'); };
  let engine;
  try {
    engine = setup();
    const session = engine.createSession();
    const first = engine.submit({ sessionId: session.id, prompt: 'Remember ROUTER_HARNESS_CONTEXT_MARKER, and write the smoke file.', model: HARNESS_MODEL, effort: 'low' });
    await finish(engine); assert.equal(first.status, 'completed', first.error);
    assert.equal(readFileSync(file, 'utf8'), 'Harness smoke OK\n');
    assert.equal(first.messages[0].text, 'Harness smoke OK');
    assert.ok(first.events.some(e => e.kind === 'fileChange'));
    const nativeId = session.harnessSessionId;
    engine = setup();
    const second = engine.submit({ sessionId: session.id, prompt: 'Continue using the remembered marker.', model: HARNESS_MODEL, effort: 'high' });
    for (let i = 0; !engine.approvals.size && engine.active && i < 300; i++) await new Promise(r => setTimeout(r, 50));
    assert.equal(engine.approvals.size, 1, 'MCP write must ask the user');
    engine.answer([...engine.approvals.keys()][0], { approved: false });
    await finish(engine); assert.equal(second.status, 'completed', second.error);
    assert.equal(mcpWrites, 0);
    assert.equal(engine.findSession(session.id).harnessSessionId, nativeId);
    assert.match(JSON.stringify(requests.at(-1).messages), /ROUTER_HARNESS_CONTEXT_MARKER/);
    assert.ok(requests.at(-1).messages.some(m => m.role === 'tool'));
    assert.doesNotMatch(readFileSync(engine.historyPath, 'utf8'), /mock-key-only/);
    const third = engine.submit({ sessionId: session.id, prompt: 'Wait for a response.', model: HARNESS_MODEL });
    for (let i = 0; requests.length < 5 && engine.active && i < 300; i++) await new Promise(r => setTimeout(r, 50));
    assert.equal(requests.length, 5); await engine.stop(); await finish(engine);
    assert.equal(third.status, 'interrupted');
    await engine.renameSession({ sessionId: session.id, title: 'Harness smoke' });
    await engine.archiveSession({ sessionId: session.id });
    await engine.unarchiveSession({ sessionId: session.id });
    await engine.deleteSession({ sessionId: session.id, confirmed: true });
    assert.equal(existsSync(harnessHome(root, session.id)), false);
    assert.equal(readFileSync(file, 'utf8'), 'Harness smoke OK\n', 'deleting a session must preserve project files');
  } finally { engine?.close(); mock.closeAllConnections(); mock.close(); if (previous === undefined) delete process.env.ROUTER_HARNESS_BIN; else process.env.ROUTER_HARNESS_BIN = previous; }
});
