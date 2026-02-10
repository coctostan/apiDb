import fs from 'node:fs/promises';
import path from 'node:path';

async function existsDir(p) {
  try {
    const st = await fs.stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

export async function findWorkspaceRoot({ cwd = process.cwd(), rootFlag } = {}) {
  if (rootFlag) {
    return { root: path.resolve(rootFlag), reason: 'explicit --root' };
  }

  let cur = path.resolve(cwd);

  while (true) {
    if (await existsDir(path.join(cur, '.apidb'))) {
      return { root: cur, reason: 'found .apidb directory' };
    }

    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  return { root: path.resolve(cwd), reason: 'default to cwd' };
}
