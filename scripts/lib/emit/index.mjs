import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {string} outRoot output/
 * @param {object[]} results
 */
export function writeIndex(outRoot, results) {
  const index = {
    generated_at: new Date().toISOString(),
    count: results.length,
    ok: results.filter((r) => r.status === 'ok').length,
    failed: results.filter((r) => r.status !== 'ok').length,
    profiles: results,
  };
  fs.mkdirSync(outRoot, { recursive: true });
  fs.writeFileSync(path.join(outRoot, 'index.json'), JSON.stringify(index, null, 2) + '\n', 'utf8');
  return index;
}
