import YAML from 'yaml';

function validateOpenApiObject(obj, filename) {
  if (!obj || typeof obj !== 'object') {
    throw new Error(`Not an OpenAPI document (${filename}): top-level must be an object`);
  }
  if (typeof obj.openapi !== 'string' || !obj.openapi.trim()) {
    throw new Error(`Not an OpenAPI document (${filename}): missing "openapi" version field`);
  }
  if (!/^3(?:\.\d+){1,2}$/.test(obj.openapi.trim())) {
    throw new Error(`Unsupported OpenAPI version (${filename}): expected OpenAPI 3.x`);
  }
  return obj;
}

export function parseOpenApiBytes({ bytes, filename = 'spec' }) {
  const text = bytes.toString('utf8');

  try {
    return validateOpenApiObject(JSON.parse(text), filename);
  } catch (e) {
    if (e instanceof SyntaxError) {
      // fall through to YAML parse
    } else {
      throw e;
    }
  }

  try {
    return validateOpenApiObject(YAML.parse(text), filename);
  } catch (e) {
    throw new Error(`Failed to parse OpenAPI as JSON or YAML (${filename}): ${e.message}`);
  }
}
