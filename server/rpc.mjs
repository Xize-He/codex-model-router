import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';

export class CodexRPC extends EventEmitter {
  constructor({ bin = process.env.ROUTER_CODEX_BIN || 'codex', args = [], secretEnv = [] } = {}) {
    super(); this.seq = 0; this.pending = new Map(); this.closed = false; this.stderr = '';
    const pluginNames = ['codex-app-tools','visualize','sites','browser','unified-computer-use'];
    const plugins = pluginNames.flatMap(name => ['-c', `plugins."${name}@openai-bundled".enabled=false`]);
    // Do not attach this independent client to the parent desktop task's IPC bridge.
    const env = { ...process.env };
    for (const key of ['CODEX_APP_TOOLS_PIPE_PATH', 'CODEX_INTERNAL_ORIGINATOR_OVERRIDE', 'CODEX_SESSION_ID', 'CODEX_THREAD_ID']) delete env[key];
    for (const key of Object.keys(env)) if (secretEnv.some(name => name.toLowerCase() === key.toLowerCase())) delete env[key];
    this.child = spawn(bin, ['app-server', '--stdio',
      '-c', 'features.apps=false', '-c', 'mcp_servers.node_repl.enabled=false',
      '-c', 'mcp_servers.company_memory.enabled=false',
      '-c', 'features.respect_system_proxy=true',
      '-c', 'features.computer_use=false', '-c', 'features.browser_use=false', '-c', 'features.in_app_browser=false',
      ...plugins, ...args], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    createInterface({ input: this.child.stdout }).on('line', line => {
      let m; try { m = JSON.parse(line); } catch { return; }
      if (m.method) { this.emit(m.id !== undefined ? 'request' : 'notification', m); return; }
      const p = this.pending.get(m.id); if (!p) return;
      clearTimeout(p.timer); this.pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
    });
    this.child.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk.toString()).slice(-4000); });
    this.child.stdin.on('error', () => {});
    this.child.on('error', e => this.fail(e));
    this.child.on('exit', code => {
      const detail = this.stderr.trim().split(/\r?\n/).slice(-4).join(' · ');
      this.fail(new Error(`Codex 进程已退出 (${code})${detail ? `：${detail}` : ''}`));
    });
  }
  fail(error) {
    if (this.closed) return; this.closed = true;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear(); this.emit('closed', error);
  }
  write(m) { if (this.closed) throw new Error('Codex 尚未连接'); this.child.stdin.write(JSON.stringify(m) + '\n'); }
  request(method, params, timeout = 30000) {
    if (this.closed) return Promise.reject(new Error('Codex 尚未连接'));
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} 请求超时`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, ...(params === undefined ? {} : { params }) }); } catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }
  respond(id, result) { if (!this.closed) this.write({ id, result }); }
  reject(id, message) { if (!this.closed) this.write({ id, error: { code: -32601, message } }); }
  async initialize() {
    const info = await this.request('initialize', { clientInfo: { name: 'local_model_router', title: 'Model Router', version: '0.3.0' }, capabilities: { experimentalApi: true } });
    this.write({ method: 'initialized' }); return info;
  }
  close() { this.child.stdin.end(); const timer = setTimeout(() => this.child.kill(), 1500); timer.unref(); this.child.once('exit', () => clearTimeout(timer)); this.fail(new Error('服务已停止')); }
}
