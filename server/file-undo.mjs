import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, realpathSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { applyPatch, parsePatch, reversePatch } from 'diff';

const digest = bytes => bytes === null ? null : createHash('sha256').update(bytes).digest('hex');
function manifestPath(dataDir, taskId) {
  if (!/^[a-f0-9-]{36}$/i.test(taskId)) throw new Error('撤销记录无效');
  return path.join(dataDir, 'undo', taskId + '.json');
}
function safePath(cwd, file) {
  const root = realpathSync(cwd), target = path.resolve(root, file), relative = path.relative(root, target);
  if (!relative || relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) throw new Error('仅能撤销本会话工作目录内的文件');
  const parts = relative.split(path.sep);
  if (parts.some(part => ['.git', '.codex', '.agents'].includes(part.toLowerCase()) || /[:]/.test(part))) throw new Error('该路径不支持网页撤销');
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && (!stat.isFile() || stat.nlink > 1))) throw new Error('链接或特殊文件不支持网页撤销');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return target;
}
function readFile(file) {
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error('该文件类型或大小不支持网页撤销');
    return readFileSync(file);
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function text(bytes) {
  if (bytes === null) return '';
  const result = bytes.toString('utf8');
  if (!Buffer.from(result).equals(bytes) || result.includes('\0')) throw new Error('仅支持 UTF-8 文本文件撤销');
  return result;
}
function reverseContent(after, change) {
  if (typeof change.diff !== 'string') throw new Error('缺少可撤销的差异记录');
  const patches = parsePatch(change.diff);
  if (patches.length === 1 && patches[0].hunks.length) {
    const before = applyPatch(after, reversePatch(patches[0]), { fuzzFactor: 0, autoConvertLineEndings: false });
    if (before === false || applyPatch(before, patches[0], { fuzzFactor: 0, autoConvertLineEndings: false }) !== after) throw new Error('差异与当前文件不一致，无法安全撤销');
    return before;
  }
  // Codex reports the full file content for add/delete operations.
  if (change.kind?.type === 'add' && after === change.diff) return '';
  if (change.kind?.type === 'delete' && after === '') return change.diff;
  throw new Error('此差异格式不支持安全撤销');
}
export function prepareUndo(dataDir, taskId, cwd, items) {
  const records = new Map();
  function record(file) {
    const absolute = safePath(cwd, file);
    if (!records.has(absolute)) {
      if (records.size >= 100) throw new Error('本轮文件过多，暂不支持网页撤销');
      const after = readFile(absolute);
      records.set(absolute, { path: absolute, after, before: after });
    }
    return records.get(absolute);
  }
  const unique = [...new Map(items.filter(item => item.type === 'fileChange').map(item => [item.id, item])).values()];
  for (const item of unique.reverse()) {
    if (item.status !== 'completed') continue;
    for (const change of [...item.changes].reverse()) {
      const kind = change.kind?.type;
      const destination = record(change.kind?.move_path || change.path);
      if (kind !== 'delete' && destination.before === null) throw new Error('修改后的文件不存在');
      if (kind === 'delete' && destination.before !== null) throw new Error('已删除的文件又被创建，无法安全撤销');
      const before = reverseContent(text(destination.before), change);
      if (kind === 'add') {
        if (before !== '') throw new Error('新增文件的差异不完整');
        destination.before = null;
      } else if (change.kind?.move_path) {
        const source = record(change.path);
        if (source.before !== null) throw new Error('原路径已存在文件，无法撤销重命名');
        source.before = Buffer.from(before); destination.before = null;
      } else destination.before = Buffer.from(before);
    }
  }
  const files = [...records.values()].filter(file => digest(file.before) !== digest(file.after));
  if (!files.length) throw new Error('没有可撤销的文件改动');
  if (files.reduce((sum, file) => sum + (file.before?.length || 0) + (file.after?.length || 0), 0) > 16 * 1024 * 1024) throw new Error('本轮改动过大，暂不支持网页撤销');
  const manifest = { cwd: realpathSync(cwd), status: 'available', files: files.map(file => ({ path: file.path, hash: digest(file.after), before: file.before?.toString('base64') ?? null, after: file.after?.toString('base64') ?? null })) };
  const target = manifestPath(dataDir, taskId); mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(manifest), { mode: 0o600 });
  return { status: 'available' };
}
export function undoFiles(dataDir, taskId) {
  const target = manifestPath(dataDir, taskId), manifest = JSON.parse(readFileSync(target, 'utf8'));
  if (manifest.status !== 'available') throw new Error('本轮改动已撤销或需要手动处理');
  const verify = file => {
    safePath(manifest.cwd, file.path);
    if (digest(readFile(file.path)) !== file.hash) throw new Error(`文件在任务结束后又被修改，未执行撤销：${file.path}`);
  };
  for (const file of manifest.files) verify(file);
  // Persist a recovery journal before touching any files. Never repeat a partial undo.
  manifest.status = 'applying'; writeFileSync(target, JSON.stringify(manifest));
  try {
    for (const file of manifest.files) {
      verify(file);
      if (file.before === null) unlinkSync(file.path);
      else {
        const temporary = file.path + `.router-undo-${randomUUID()}`;
        try {
          const mode = file.after === null ? 0o600 : lstatSync(file.path).mode;
          writeFileSync(temporary, Buffer.from(file.before, 'base64'), { flag: 'wx', mode });
          verify(file); renameSync(temporary, file.path);
        } finally { try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
      }
    }
    manifest.status = 'undone'; manifest.at = Date.now(); writeFileSync(target, JSON.stringify(manifest));
    return { status: 'undone', at: manifest.at };
  } catch (error) {
    manifest.status = 'failed'; writeFileSync(target, JSON.stringify(manifest));
    throw new Error(`撤销未能全部完成，已保留恢复记录，请勿重复操作：${error.message}`);
  }
}
