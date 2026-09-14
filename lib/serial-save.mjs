// Preserve edit order without disabling the next text field while a request is in flight.
export function createSerialSaveQueue() {
  /** @type {Promise<unknown>} */
  let tail = Promise.resolve();
  /** @template T @param {() => Promise<T>} save @returns {Promise<T>} */
  return function enqueue(save) {
    const next = tail.then(save);
    tail = next.catch(() => {});
    return next;
  };
}
