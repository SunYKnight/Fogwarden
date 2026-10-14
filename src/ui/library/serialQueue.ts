/**
 * Runs async tasks one after another. Edits of one document go through a queue so each write starts from what the
 * previous one stored, never from a copy taken before it finished.
 */
export function serialQueue(): <R>(task: () => Promise<R>) => Promise<R> {
  let tail: Promise<unknown> = Promise.resolve();
  return (task) => {
    const run = tail.then(task);
    // The caller handles the failure; the tasks queued after it still run.
    tail = run.catch(() => undefined);
    return run;
  };
}
