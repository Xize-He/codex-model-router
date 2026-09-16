import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import { existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync, lstatSync, rmSync } from 'node:fs';
import path from 'node:path';

export const HARNESS_MODEL = 'deepseek-harness/flash';
export const harnessModel = {
  model: HARNESS_MODEL, displayName: 'DeepSeek V4.1 Flash · Harness',
  description: 'DeepSeek Harness · 独立执行引擎', manualOnly: true,
  defaultReasoningEffort: 'high', inputModalities: ['text', 'image'],
  supportedReasoningEfforts: ['low', 'high', 'max'].map(reasoningEffort => ({ reasoningEffort })),
};

export function harnessRuntime(root) {
  const bin = process.env.ROUTER_HARNESS_BIN || path.join(root, 'data/harness-runtime/node_modules/@deepseek-ai/dsh/lib/bin.js');
  if (!path.isAbsolute(bin) || !existsSync(bin)) return null;
  let version = null;
  try { version = JSON.parse(readFileSync(path.resolve(bin, '../../package.json'), 'utf8')).version; } catch { /* Custom executable. */ }
  return { bin, version };
}

export function harnessHome(root, id) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Harness 会话编号无效');
  return path.join(root, 'data/harness-sessions', id);
}

export function deleteHarnessSession(root, id) {
  const home = harnessHome(root, id);
  if (!existsSync(home)) return;
  // Only our isolated runtime home may be removed; never the project or desktop profile.
  if (lstatSync(home).isSymbolicLink() || realpathSync(home) !== path.resolve(home)) throw new Error('Harness 会话目录不是独立本地目录');
  rmSync(home, { recursive: true });
}

export function harnessEnvironment(home, key, inherited = process.env) {
  const env = Object.fromEntries(Object.entries(inherited).filter(([name]) =>
    !/(?:TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL)/i.test(name) && !/^(?:CODEX_|DSH_|DEEPSEEK_|OPENAI_|ANTHROPIC_|NODE_OPTIONS$)/i.test(name)));
  return { ...env, DSH_HOME: home, DSH_PERMISSION_MODE: 'workspace-write', DSH_TELEMETRY_MODE: 'OFF', DEEPSEEK_API_KEY: key };
}

export class HarnessRPC extends EventEmitter {
  constructor({ command, args, cwd, env }) {
    super();
    this.pending = new Map(); this.sequence = 0; this.closed = false;
    this.child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' });
    this.exited = new Promise(resolve => { this.child.once('exit', resolve); this.child.once('error', resolve); });
    // Never forward stderr (provider errors can contain secrets or MCP addresses).
    this.child.stderr.on('data', () => {});
    this.child.stdin.on('error', () => this.fail(new Error('Harness 输入通道已关闭')));
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', line => {
      if (line.length > 16 * 1024 * 1024) return this.fail(new Error('Harness 返回内容过大'));
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.jsonrpc !== '2.0') return;
      if (message.method) this.emit(message.id === undefined ? 'notification' : 'request', message);
      else {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id); clearTimeout(pending.timer);
        // Keep untrusted upstream diagnostics out of public errors.
        if (message.error) pending.reject(new Error(`Harness ${pending.method} 失败（${Number(message.error.code) || '协议错误'}）`));
        else pending.resolve(message.result);
      }
    });
    this.child.on('error', () => this.fail(new Error('Harness 无法启动，请检查安装和 Node.js 版本')));
    this.child.on('exit', code => this.fail(new Error(`Harness 进程已退出（${code ?? '中断'}）`)));
  }
  send(message) { if (!this.closed) this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n'); }
  notify(method, params) { this.send({ method, params }); }
  respond(id, result) { this.send({ id, result }); }
  reject(id) { this.send({ id, error: { code: -32601, message: 'Client capability unavailable' } }); }
  request(method, params, timeout = 60000) {
    if (this.closed) return Promise.reject(new Error('Harness 已断开连接'));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Harness ${method} 超时`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer, method }); this.send({ id, method, params });
    });
  }
  fail(error) {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear(); this.emit('closed', error);
  }
  async close() {
    if (this.closing) return this.closing;
    this.fail(new Error('Harness 已停止'));
    this.lines.close(); this.child.stdin.end();
    this.closing = (async () => {
      let timer;
      const graceful = await Promise.race([this.exited.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 1500); })]);
      clearTimeout(timer);
      if (!graceful && this.child.pid) {
        if (process.platform === 'win32') {
          await new Promise(resolve => {
            const killer = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/taskkill.exe'), ['/PID', String(this.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
            killer.once('error', () => { this.child.kill(); resolve(); }); killer.once('exit', resolve);
          });
        } else { try { process.kill(-this.child.pid, 'SIGKILL'); } catch { this.child.kill(); } }
      }
    })();
    return this.closing;
  }
}

export function harnessLaunch(root, session, key, cwd) {
  const runtime = harnessRuntime(root);
  if (!runtime) throw new Error('尚未安装 DeepSeek Harness，请执行 npm run harness:install 后重试');
  const home = harnessHome(root, session.id); mkdirSync(home, { recursive: true });
  const patch = path.join(home, 'router.patch.json');
  writeFileSync(patch, JSON.stringify([
    { id: 'acp', config: { provider: 'deepseek-official', model: 'deepseek-flash' } },
    { id: 'session-telemetry-otel', disabled: true },
    { id: 'sandbox-policy', config: { mode: 'workspace-write', workspaceRoot: cwd } },
    { id: 'approval', config: { policy: 'ask' } },
  ]));
  const script = /\.[cm]?js$/i.test(runtime.bin);
  if (script && Number(process.versions.node.split('.')[0]) < 24) throw new Error('DeepSeek Harness 需要 Node.js 24 或更新版本');
  return { command: script ? process.execPath : runtime.bin,
    args: [...(script ? [runtime.bin] : []), '--profile', 'acp', '--patch', patch],
    cwd, env: harnessEnvironment(home, key) };
}

export function createHarness(root, session, key, cwd) { return new HarnessRPC(harnessLaunch(root, session, key, cwd)); }

export function flattenOptions(options = []) {
  return options.flatMap(item => Array.isArray(item.options) ? flattenOptions(item.options) : [item]);
}
