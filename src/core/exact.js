import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { loadConfig } from './config.js';
import { opDocId, schemaDocId } from './docIds.js';

async function getEnabledSourceIds({ root }) {
  if (!root) {
    throw new Error('Workspace root is required when --source is omitted');
  }

  const cfg = await loadConfig({ root });
  const enabledSourceIds = (cfg.sources ?? []).filter((s) => s.enabled).map((s) => s.id);

  if (enabledSourceIds.length === 0) {
    throw new Error('No enabled sources found. Enable at least one source in .apidb/config.json.');
  }

  return enabledSourceIds;
}

function findMatchingDocs({ root, kind, params, enabledSourceIds }) {
  const dbPath = path.join(root, '.apidb', 'index.sqlite');
  const db = new DatabaseSync(dbPath, { readOnly: true });

  try {
    const placeholders = enabledSourceIds.map((_, i) => `$source${i}`);
    const queryParams = {
      ...params,
      $kind: kind
    };

    enabledSourceIds.forEach((id, i) => {
      queryParams[`$source${i}`] = id;
    });

    const whereClause =
      kind === 'operation'
        ? 'method = $method AND path = $path'
        : 'schemaName = $schemaName';

    const sql = `
      SELECT id, sourceId
      FROM docs
      WHERE kind = $kind
        AND ${whereClause}
        AND sourceId IN (${placeholders.join(', ')})
      ORDER BY sourceId, id
    `;

    return db.prepare(sql).all(queryParams);
  } finally {
    db.close();
  }
}

function resolveFromMatches({ matches, notFoundMessage, ambiguousPrefix }) {
  if (matches.length === 1) {
    return matches[0].id;
  }

  if (matches.length === 0) {
    throw new Error(notFoundMessage);
  }

  const candidateSources = [...new Set(matches.map((m) => m.sourceId))].sort();
  throw new Error(
    `${ambiguousPrefix}: found in multiple enabled sources (${candidateSources.join(', ')}). ` +
      `Re-run with --source <id> to disambiguate.`
  );
}

async function resolveOperationDocIdWithoutSource({ root, method, path }) {
  const enabledSourceIds = await getEnabledSourceIds({ root });
  const methodUpper = String(method).toUpperCase();
  const matches = findMatchingDocs({
    root,
    kind: 'operation',
    params: { $method: methodUpper, $path: path },
    enabledSourceIds
  });

  return resolveFromMatches({
    matches,
    notFoundMessage:
      `Operation not found for ${methodUpper} ${path} in enabled sources (${enabledSourceIds.join(', ')}). ` +
      'Check the method/path or pass --source <id>.',
    ambiguousPrefix: `Ambiguous operation for ${methodUpper} ${path}`
  });
}

async function resolveSchemaDocIdWithoutSource({ root, schemaName }) {
  const enabledSourceIds = await getEnabledSourceIds({ root });
  const matches = findMatchingDocs({
    root,
    kind: 'schema',
    params: { $schemaName: schemaName },
    enabledSourceIds
  });

  return resolveFromMatches({
    matches,
    notFoundMessage:
      `Schema not found: ${schemaName} in enabled sources (${enabledSourceIds.join(', ')}). ` +
      'Check the schema name or pass --source <id>.',
    ambiguousPrefix: `Ambiguous schema: ${schemaName}`
  });
}

export function resolveOperationDocId({ root, method, path, sourceId }) {
  if (sourceId != null) {
    return opDocId({ sourceId, method, path });
  }

  return resolveOperationDocIdWithoutSource({ root, method, path });
}

export function resolveSchemaDocId({ root, schemaName, sourceId }) {
  if (sourceId != null) {
    return schemaDocId({ sourceId, schemaName });
  }

  return resolveSchemaDocIdWithoutSource({ root, schemaName });
}
