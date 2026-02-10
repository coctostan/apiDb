import { opDocId, schemaDocId } from '../core/docIds.js';

const DEFAULT_LIMITS = {
  MAX_SCHEMA_PROPERTIES: 200,
  MAX_DOC_BODY_CHARS: 50_000
};

function trunc(value, n) {
  if (value == null) return value;
  const s = String(value);
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function schemaSummary(schema, limits) {
  if (!schema || typeof schema !== 'object') return null;
  if (schema.$ref) return { $ref: String(schema.$ref) };

  const out = {
    type: schema.type ?? null,
    format: schema.format ?? null,
    description: trunc(schema.description ?? null, 500)
  };

  if (schema.properties && typeof schema.properties === 'object') {
    const keys = Object.keys(schema.properties).slice(0, limits.MAX_SCHEMA_PROPERTIES);
    out.properties = keys.map((k) => {
      const p = schema.properties[k];
      return {
        name: k,
        type: p?.type ?? null,
        $ref: p?.$ref ? String(p.$ref) : null,
        description: trunc(p?.description ?? null, 200)
      };
    });
  }

  return out;
}

export function normalizeOpenApiToDocs({ sourceId, spec, limits = DEFAULT_LIMITS }) {
  const docs = [];
  const paths = spec?.paths ?? {};

  for (const [p, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;

    for (const [methodRaw, op] of Object.entries(pathItem)) {
      const method = methodRaw.toUpperCase();
      if (!['GET', 'PUT', 'POST', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'TRACE'].includes(method)) continue;
      if (!op || typeof op !== 'object') continue;

      const id = opDocId({ sourceId, method, path: p });
      const title = `${method} ${p}`;

      const json = {
        method,
        path: p,
        operationId: op.operationId ?? null,
        summary: op.summary ?? null,
        description: op.description ?? null,
        tags: Array.isArray(op.tags) ? op.tags.slice(0, 20) : []
      };

      const body = trunc(
        [title, op.operationId, op.summary, op.description, ...(Array.isArray(op.tags) ? op.tags : [])]
          .filter(Boolean)
          .join('\n'),
        limits.MAX_DOC_BODY_CHARS
      );

      docs.push({
        id,
        sourceId,
        kind: 'operation',
        title,
        method,
        path: p,
        schemaName: null,
        json,
        body
      });
    }
  }

  const schemas = spec?.components?.schemas ?? {};
  for (const [name, schema] of Object.entries(schemas)) {
    const id = schemaDocId({ sourceId, schemaName: name });
    const title = name;

    const summary = schemaSummary(schema, limits);
    const json = {
      name,
      type: schema?.type ?? null,
      description: schema?.description ?? null,
      summary
    };

    const body = trunc(
      [name, schema?.description, schema?.type, JSON.stringify(summary)].filter(Boolean).join('\n'),
      limits.MAX_DOC_BODY_CHARS
    );

    docs.push({
      id,
      sourceId,
      kind: 'schema',
      title,
      method: null,
      path: null,
      schemaName: name,
      json,
      body
    });
  }

  return docs;
}
