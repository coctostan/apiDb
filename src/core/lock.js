import fs from 'node:fs/promises';
import path from 'node:path';

function lockPath(root) {
  return path.join(root, '.apidb', 'lock');
}

export async function withWorkspaceLock({ root }, fn) {
  await fs.mkdir(path.join(root, '.apidb'), { recursive: true });

  let fh;
  try {
    fh = await fs.open(lockPath(root), 'wx');
  } catch (e) {
    if (e?.code === 'EEXIST') {
      throw new Error(`Workspace is locked: ${lockPath(root)}`);
    }
    throw new Error(`Failed to acquire workspace lock (${lockPath(root)}): ${e.message}`);
  }

  try {
    await fh.writeFile(`${process.pid}\n`, 'utf8');
    return await fn();
  } finally {
    try {
      await fh.close();
    } catch {}
    try {
      await fs.unlink(lockPath(root));
    } catch {}
  }
}
