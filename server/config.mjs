import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

export function normalizeMcpServers(config = {}) {
  const source = Array.isArray(config.mcpServers)
    ? config.mcpServers
    : config.mcpUrl
      ? [{ id: 'default', url: config.mcpUrl, tokenEnv: config.mcpTokenEnv, enabled: true }]
      : [];
  const ids = new Set();
  return source.map((item, index) => {
    const fallback = `mcp-${index + 1}`;
    let id = String(item.id || item.name || fallback).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
    const base = id; let suffix = 2;
    while (ids.has(id)) id = `${base}-${suffix++}`;
    ids.add(id);
    return {
      id,
      name: String(item.name || id),
      url: String(item.url || '').trim(),
      tokenEnv: String(item.tokenEnv || '').trim(),
      enabled: item.enabled !== false,
    };
  }).filter(item => item.url);
}

export function loadRouterConfig(root) {
  const base = readJson(path.join(root, 'router.config.json'));
  const localPath = path.join(root, 'router.config.local.json');
  const local = existsSync(localPath) ? readJson(localPath) : {};
  const merged = { ...base, ...local, routes: { ...(base.routes || {}), ...(local.routes || {}) } };
  merged.mcpServers = normalizeMcpServers(merged);
  delete merged.mcpUrl;
  delete merged.mcpTokenEnv;
  return merged;
}

export function saveRoutingConfig(root, config) {
  const localPath = path.join(root, 'router.config.local.json');
  const local = existsSync(localPath) ? readJson(localPath) : {};
  const next = {
    ...local,
    classifier: config.classifier,
    classifierEffort: config.classifierEffort,
    routes: config.routes,
  };
  const tempPath = `${localPath}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  renameSync(tempPath, localPath);
}
