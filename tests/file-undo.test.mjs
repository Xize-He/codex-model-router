import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, linkSync } from 'node:fs';
import path from 'node:path';
import { createPatch } from 'diff';
import { prepareUndo, undoFiles } from '../server/file-undo.mjs';

function setup() {
  mkdirSync('work/undo-tests', { recursive: true });
  const root = mkdtempSync(path.resolve('work/undo-tests/run-')), cwd = path.join(root, 'workspace'), data = path.join(root, 'data');
  mkdirSync(cwd); mkdirSync(data);
  return { root, cwd, data, id: randomUUID() };
}
const item = (changes, id = randomUUID()) => ({ id, type: 'fileChange', status: 'completed', changes });
const update = (file, before, after) => ({ path: file, kind: { type: 'update' }, diff: createPatch(file, before, after) });
test('undo restores updates, creations, deletions and renames, then rejects a repeat', () => {
  const { cwd, data, id } = setup();
  writeFileSync(path.join(cwd, 'a.txt'), 'after\n');
  writeFileSync(path.join(cwd, 'new.txt'), 'new\n');
  writeFileSync(path.join(cwd, 'renamed.txt'), 'renamed\n');
  const changes = [update('a.txt', 'before\n', 'after\n'), { path: 'new.txt', kind: { type: 'add' }, diff: 'new\n' }, { path: 'deleted.txt', kind: { type: 'delete' }, diff: 'deleted\n' }, { ...update('old.txt', 'old\n', 'renamed\n'), kind: { type: 'update', move_path: 'renamed.txt' } }];
  assert.equal(prepareUndo(data, id, cwd, [item(changes)]).status, 'available');
  assert.equal(undoFiles(data, id).status, 'undone');
  assert.equal(readFileSync(path.join(cwd, 'a.txt'), 'utf8'), 'before\n');
  assert.equal(readFileSync(path.join(cwd, 'deleted.txt'), 'utf8'), 'deleted\n');
  assert.equal(readFileSync(path.join(cwd, 'old.txt'), 'utf8'), 'old\n');
  assert.equal(existsSync(path.join(cwd, 'new.txt')), false);
  assert.equal(existsSync(path.join(cwd, 'renamed.txt')), false);
  assert.throws(() => undoFiles(data, id), /已撤销/);
});
test('a subsequent edit blocks the entire undo before any file is changed', () => {
  const { cwd, data, id } = setup();
  for (const file of ['a.txt', 'b.txt']) writeFileSync(path.join(cwd, file), 'after\n');
  prepareUndo(data, id, cwd, [item(['a.txt', 'b.txt'].map(file => update(file, 'before\n', 'after\n')))]);
  writeFileSync(path.join(cwd, 'b.txt'), 'user later edit\n');
  assert.throws(() => undoFiles(data, id), /又被修改/);
  assert.equal(readFileSync(path.join(cwd, 'a.txt'), 'utf8'), 'after\n');
  assert.equal(readFileSync(path.join(cwd, 'b.txt'), 'utf8'), 'user later edit\n');
});
test('repeated edits are reversed in order and replayed events are deduplicated', () => {
  const { cwd, data, id } = setup();
  writeFileSync(path.join(cwd, 'a.txt'), 'third\n');
  const first = item([update('a.txt', 'first\n', 'second\n')]), second = item([update('a.txt', 'second\n', 'third\n')]);
  prepareUndo(data, id, cwd, [first, second, second]); undoFiles(data, id);
  assert.equal(readFileSync(path.join(cwd, 'a.txt'), 'utf8'), 'first\n');
});
test('mismatched patches, outside paths and hard links are not undoable', () => {
  const { cwd, data, root } = setup();
  writeFileSync(path.join(cwd, 'a.txt'), 'unexpected\n');
  assert.throws(() => prepareUndo(data, randomUUID(), cwd, [item([update('a.txt', 'old\n', 'new\n')])]), /不一致/);
  assert.throws(() => prepareUndo(data, randomUUID(), cwd, [item([{ path: '../outside.txt', kind: { type: 'delete' }, diff: 'old' }])]), /工作目录/);
  writeFileSync(path.join(root, 'outside.txt'), 'unexpected\n');
  linkSync(path.join(root, 'outside.txt'), path.join(cwd, 'linked.txt'));
  assert.throws(() => prepareUndo(data, randomUUID(), cwd, [item([update('linked.txt', 'old\n', 'unexpected\n')])]), /链接/);
});
test('CRLF and missing final newlines survive an undo exactly', () => {
  const { cwd, data, id } = setup(), before = 'first\r\nlast', after = 'changed\r\nlast';
  writeFileSync(path.join(cwd, 'a.txt'), after);
  prepareUndo(data, id, cwd, [item([update('a.txt', before, after)])]); undoFiles(data, id);
  assert.equal(readFileSync(path.join(cwd, 'a.txt'), 'utf8'), before);
});
