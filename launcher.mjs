import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadRouterConfig } from './server/config.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
const config = loadRouterConfig(root);
const url = `http://127.0.0.1:${config.port}`;
const noOpen = process.argv.includes('--no-open');
const foreground = process.argv.includes('--foreground');
const taskName = 'Model Router Local Service';
async function state() { try { const r = await fetch(url + '/api/state', { signal: AbortSignal.timeout(1200) }); const s = await r.json(); return s.app === 'local-model-router' ? s : null; } catch { return null; } }
function show() { if (!noOpen) { const p = spawn('explorer.exe', [url], { windowsHide: true, stdio: 'ignore' }); p.on('error', () => {}); p.unref(); } console.log(`Model Router: ${url}`); }
try {
  const existing = await state();
  if (process.argv.includes('--stop')) {
    if (!existing) throw new Error('Model Router is not running.');
    const r = await fetch(url + '/api/shutdown', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Router-Token': existing.csrf }, body: '{}' });
    if (!r.ok) throw new Error('Shutdown failed.'); console.log('Model Router stopped.');
  } else if (existing) { show(); }
  else {
    let scheduled = false;
    if (process.platform === 'win32' && !foreground) {
      try { execFileSync('schtasks.exe', ['/Query', '/TN', taskName], { windowsHide: true, stdio: 'ignore' }); scheduled = true; } catch {}
    }
    if (scheduled) {
      execFileSync('schtasks.exe', ['/Run', '/TN', taskName], { windowsHide: true, stdio: 'ignore' });
      let ready;
      for (let n = 0; n < 60; n++) { await new Promise(r => setTimeout(r, 500)); ready = await state(); if (ready) break; }
      if (!ready) throw new Error('Windows service task did not start. Check Task Scheduler and data/server-error.log.');
      show(); process.exit(0);
    }
    if (!existsSync(path.join(root, 'out/index.html'))) throw new Error('Missing out/index.html. Run pnpm build first.');
    const env = { ...process.env };
    // Some non-interactive Windows launch contexts omit HOME even though USERPROFILE exists.
    // Codex requires a home directory to locate the signed-in account and configuration.
    if (!env.HOME && env.USERPROFILE) env.HOME = env.USERPROFILE;
    if (!env.CODEX_HOME && env.USERPROFILE) env.CODEX_HOME = path.join(env.USERPROFILE, '.codex');
    delete env.ROUTER_PORT;
    if (!env.ROUTER_CODEX_BIN) {
      try { env.ROUTER_CODEX_BIN = execFileSync('where.exe', ['codex.exe'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/)[0]; }
      catch {
        const binRoot = path.join(env.LOCALAPPDATA || '', 'OpenAI/Codex/bin');
        const paths = existsSync(binRoot) ? readdirSync(binRoot).map(d => path.join(binRoot, d, 'codex.exe')).filter(existsSync).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs) : [];
        env.ROUTER_CODEX_BIN = paths[0];
      }
    }
    if (!env.ROUTER_CODEX_BIN) throw new Error('Codex executable not found. Install and sign in to Codex first.');
    const credentialFile = path.join(root, 'data/mcp-credentials.json');
    if (existsSync(credentialFile)) {
      const cachedItems = JSON.parse(readFileSync(credentialFile, 'utf8').replace(/^\uFEFF/, ''));
      for (const cached of Array.isArray(cachedItems) ? cachedItems : [cachedItems]) {
        const server = config.mcpServers.find(item => item.url === cached.url && item.tokenEnv === cached.tokenEnv);
        if (!server || !cached.tokenEnv || env[cached.tokenEnv]) continue;
        // .NET DPAPI avoids PowerShell 5/7 module-path conflicts and script-policy changes.
        const command = "$ErrorActionPreference='Stop'; [void][Reflection.Assembly]::Load('System.Security, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a'); $h=$env:ROUTER_PROTECTED_TOKEN; $b=[byte[]]::new($h.Length/2); for($i=0;$i -lt $b.Length;$i++){$b[$i]=[Convert]::ToByte($h.Substring($i*2,2),16)}; [Console]::Write([Text.Encoding]::Unicode.GetString([Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))";
        env[cached.tokenEnv] = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true, env: { ...env, ROUTER_PROTECTED_TOKEN: cached.protectedToken }, stdio: ['ignore', 'pipe', 'pipe'] });
        if (!env[cached.tokenEnv]) throw new Error(`Cannot decrypt MCP credentials for ${cached.tokenEnv}.`);
      }
    }
    const data = path.join(root, 'data'); mkdirSync(data, { recursive: true });
    const stdout = openSync(path.join(data, 'server.log'), 'a'), stderr = openSync(path.join(data, 'server-error.log'), 'a');
    const child = spawn(process.execPath, [path.join(root, 'server/index.mjs')], { cwd: root, env, detached: true, windowsHide: true, stdio: ['ignore', stdout, stderr] });
    closeSync(stdout); closeSync(stderr); let launchError;
    child.on('error', e => { launchError = e.message; });
    if (!foreground) child.unref();
    else child.on('exit', code => { process.exitCode = code || 0; });
    let ready;
    for (let n = 0; n < 40; n++) { if (launchError) throw new Error(launchError); await new Promise(r => setTimeout(r, 250)); ready = await state(); if (ready) break; }
    if (!ready) throw new Error('Service did not start. See data/server-error.log.'); show();
  }
} catch (e) { console.error(e.message); process.exitCode = 1; }
