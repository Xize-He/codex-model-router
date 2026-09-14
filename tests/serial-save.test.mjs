import test from 'node:test';
import assert from 'node:assert/strict';
import { createSerialSaveQueue } from '../lib/serial-save.mjs';

test('rapid edits save in order even when the first request is slow', async () => {
  const enqueue = createSerialSaveQueue(),
    saved = [];
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const first = enqueue(async () => {
    await gate;
    saved.push('first');
    return true;
  });
  const second = enqueue(async () => {
    saved.push('second');
    return true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(saved, []);
  release();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.deepEqual(saved, ['first', 'second']);
});

test('a failed save does not prevent subsequent edits from being saved', async () => {
  const enqueue = createSerialSaveQueue();
  const first = enqueue(async () => {
    throw new Error('offline');
  });
  const second = enqueue(async () => 'saved');
  await assert.rejects(first, /offline/);
  assert.equal(await second, 'saved');
});
