import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('DeepSeek Harness requires Node.js 24 or newer.');
const manager = process.env.npm_execpath;
if (!manager || !/\b(?:pnpm|npm)(?:-cli)?\.[cm]?js$/i.test(path.basename(manager))) throw new Error('Run this script with pnpm run harness:install or npm run harness:install.');
const directory = fileURLToPath(new URL('../data/harness-runtime/', import.meta.url));
mkdirSync(directory, { recursive: true });
writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'model-router-harness-runtime', private: true, type: 'module', dependencies: { '@deepseek-ai/dsh': '0.1.5-rc.1' } }, null, 2) + '\n');
// Do not attach this optional runtime to the application's pnpm workspace.
writeFileSync(path.join(directory, 'pnpm-workspace.yaml'), "packages:\n  - '.'\nallowBuilds:\n  '@deepseek-ai/dsh-subprocess-local': true\n  koffi: true\n  node-pty: true\n  '@google/genai': false\n  protobufjs: false\n");
const args = /pnpm/i.test(path.basename(manager))
  ? [manager, '--dir', directory, 'install', '--no-frozen-lockfile']
  : [manager, 'install', '--prefix', directory, '--workspaces=false', '--no-audit', '--no-fund'];
const child = spawn(process.execPath, args, { stdio: 'inherit', windowsHide: true, env: { ...process.env, CI: 'true' } });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
