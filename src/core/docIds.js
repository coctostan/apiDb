export function opDocId({ sourceId, method, path }) {
  return `op:${sourceId}:${String(method).toUpperCase()}:${path}`;
}

export function schemaDocId({ sourceId, schemaName }) {
  return `schema:${sourceId}:${schemaName}`;
}
