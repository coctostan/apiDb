import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export async function ensureBlobDir({ root }) {
  const blobDir = path.join(root, '.apidb', 'blobs');
  await fs.mkdir(blobDir, { recursive: true });
  return blobDir;
}

export async function writeBlobIfMissing({ root, sha256, bytes }) {
  const blobDir = path.join(root, '.apidb', 'blobs');
  const blobPath = path.join(blobDir, sha256 + '.bin');

  try {
    await fs.access(blobPath);
    return { written: false, blobPath };
  } catch {
    // File doesn't exist — write atomically via temp + rename
    const tmpPath = blobPath + '.tmp.' + process.pid;
    await fs.writeFile(tmpPath, bytes);
    await fs.rename(tmpPath, blobPath);
    return { written: true, blobPath };
  }
}
