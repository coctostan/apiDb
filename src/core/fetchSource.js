import fs from 'node:fs/promises';
import { assertSafeHttpUrl } from './net.js';
import { sha256Hex, ensureBlobDir, writeBlobIfMissing } from './blobStore.js';
import {
  upsertHttpCacheRow,
  insertBlobRow,
  getLatestBlobForSource,
  pruneBlobsKeepLatestPerSource
} from './stateDb.js';
import { nowIso } from './util.js';

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

async function fetchWithSafeRedirects({ location, allowPrivateNet, maxRedirects = 5, headers = {} }) {
  let current = location;

  for (let i = 0; i <= maxRedirects; i += 1) {
    await assertSafeHttpUrl(current, { allowPrivateNet });

    const res = await fetch(current, { redirect: 'manual', headers });
    if (res.status >= 300 && res.status < 400 && res.status !== 304) {
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

export async function fetchSourceBytes({
  location,
  maxBytes,
  allowPrivateNet = false,
  stateDb = null,
  sourceId = null,
  root = null
}) {
  let url;
  try {
    url = new URL(location);
  } catch {
    url = null;
  }

  if (url && (url.protocol === 'http:' || url.protocol === 'https:')) {
    // Build conditional headers from cache
    const reqHeaders = {};
    let cacheRow = null;
    if (stateDb && sourceId) {
      cacheRow = stateDb.prepare('SELECT * FROM source_http_cache WHERE sourceId = ?').get(sourceId);
      if (cacheRow) {
        if (cacheRow.etag) reqHeaders['If-None-Match'] = cacheRow.etag;
        if (cacheRow.lastModified) reqHeaders['If-Modified-Since'] = cacheRow.lastModified;
      }
    }

    const res = await fetchWithSafeRedirects({ location, allowPrivateNet, headers: reqHeaders });

    // Handle 304 Not Modified
    if (res.status === 304 && stateDb && sourceId && root) {
      const latestBlob = getLatestBlobForSource(stateDb, sourceId);
      if (latestBlob) {
        const bytes = await fs.readFile(latestBlob.blobPath);
        // Update lastCheckedAt
        upsertHttpCacheRow(stateDb, {
          sourceId,
          location,
          effectiveUrl: cacheRow?.effectiveUrl ?? null,
          etag: cacheRow?.etag ?? null,
          lastModified: cacheRow?.lastModified ?? null,
          lastCheckedAt: nowIso(),
          lastFetchedAt: cacheRow?.lastFetchedAt ?? null,
          lastError: null
        });
        return {
          bytes,
          kind: 'url',
          contentType: latestBlob.contentType ?? null
        };
      }
    }

    if (!res.ok) {
      throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    }

    const bytes = await readBoundedResponseBytes(res, maxBytes);

    // Persist blob and cache metadata when stateDb context is available
    if (stateDb && sourceId && root) {
      const now = nowIso();
      const etag = res.headers.get('etag') ?? null;
      const lastModified = res.headers.get('last-modified') ?? null;
      const contentType = res.headers.get('content-type') ?? null;

      // Persist blob to disk
      const sha = sha256Hex(bytes);
      await ensureBlobDir({ root });
      const { blobPath } = await writeBlobIfMissing({ root, sha256: sha, bytes });

      // Record blob row
      insertBlobRow(stateDb, {
        sha256: sha,
        sourceId,
        fetchedAt: now,
        kind: 'url',
        location,
        effectiveUrl: null,
        contentType,
        bytesLength: bytes.length,
        blobPath
      });

      // Prune old blobs for this source
      await pruneBlobsKeepLatestPerSource(stateDb, { root, sourceId });

      // Upsert cache row
      upsertHttpCacheRow(stateDb, {
        sourceId,
        location,
        effectiveUrl: null,
        etag,
        lastModified,
        lastCheckedAt: now,
        lastFetchedAt: now,
        lastError: null
      });
    }

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
