import { opDocId, schemaDocId } from './docIds.js';

export function resolveOperationDocId({ method, path, sourceId }) {
  if (!sourceId) {
    throw new Error('sourceId is required for v1 exact lookups');
  }
  return opDocId({ sourceId, method, path });
}

export function resolveSchemaDocId({ schemaName, sourceId }) {
  if (!sourceId) {
    throw new Error('sourceId is required for v1 exact lookups');
  }
  return schemaDocId({ sourceId, schemaName });
}
