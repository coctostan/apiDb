import fs from 'node:fs/promises';
import { assertSafeHttpUrl } from './net.js';

async function readBoundedResponseBytes(res, maxBytes) {
  const contentLength = Number(res.headers.get('content-length') || 0);
  if (contentLength > maxBytes) {
    throw new Error(`MAX_SPEC_BYTES exceeded: ${contentLength} > ${maxBytes}`);
  }

  if (!res.body) {
    throw new Error('Fetch response did not include a readable body stream');
  }

  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    total += value.byteLength;
    if (total > maxBytes) {
      throw new Error(`MAX_SPEC_BYTES exceeded: ${total} > ${maxBytes}`);
    }

    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks, total);
}

async function fetchWithSafeRedirects({ location, allowPrivateNet, maxRedirects = 5 }) {
  let current = location;

  for (let i = 0; i <= maxRedirects; i += 1) {
    await assertSafeHttpUrl(current, { allowPrivateNet });

    const res = await fetch(current, { redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      if (!next) {
        throw new Error(`Fetch failed: redirect (${res.status}) without Location header`);
      }
      if (i === maxRedirects) {
        throw new Error(`Fetch failed: too many redirects (>${maxRedirects})`);
      }
      current = new URL(next, current).toString();
      continue;
    }

    return res;
  }

  throw new Error('Fetch failed: redirect loop');
}

export async function fetchSourceBytes({ location, maxBytes, allowPrivateNet = false }) {
  let url;
  try {
    url = new URL(location);
  } catch {
    url = null;
  }

  if (url && (url.protocol === 'http:' || url.protocol === 'https:')) {
    const res = await fetchWithSafeRedirects({ location, allowPrivateNet });
    if (!res.ok) {
      throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    }

    const bytes = await readBoundedResponseBytes(res, maxBytes);
    return {
      bytes,
      kind: 'url',
      contentType: res.headers.get('content-type') ?? null
    };
  }

  const st = await fs.stat(location);
  if (st.size > maxBytes) {
    throw new Error(`MAX_SPEC_BYTES exceeded: ${st.size} > ${maxBytes}`);
  }

  const bytes = await fs.readFile(location);
  return {
    bytes,
    kind: 'file',
    contentType: null
  };
}
