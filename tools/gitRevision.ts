import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Short commit hash of the checkout at `root`, '-dirty' with local changes, 'nogit' outside a checkout. */
export function gitRevision(root: string): string {
  const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const inCheckout = existsSync(join(root, '.git'));
  const dirty = inCheckout && git(['status', '--porcelain']).length > 0;
  return inCheckout ? `${git(['rev-parse', '--short', 'HEAD'])}${dirty ? '-dirty' : ''}` : 'nogit';
}
