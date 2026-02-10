import fs from 'node:fs/promises';
import path from 'node:path';
import { nowIso } from './util.js';

function configPath(root) {
  return path.join(root, '.apidb', 'config.json');
}

export async function initConfig({ root }) {
  await fs.mkdir(path.join(root, '.apidb'), { recursive: true });
  const p = configPath(root);

  try {
    await fs.stat(p);
    return;
  } catch {
    // continue
  }

  const cfg = { version: 1, sources: [] };
  await fs.writeFile(p, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

export async function loadConfig({ root }) {
  const raw = await fs.readFile(configPath(root), 'utf8');
  const cfg = JSON.parse(raw);
  validateConfig(cfg);
  cfg.sources ??= [];
  return cfg;
}

export async function saveConfig({ root, config }) {
  validateConfig(config);
  await fs.mkdir(path.join(root, '.apidb'), { recursive: true });
  await fs.writeFile(configPath(root), JSON.stringify(config, null, 2) + '\n', 'utf8');
}

export function validateConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') throw new Error('Invalid config: not an object');
  if (cfg.version !== 1) throw new Error('Invalid config: version must be 1');
  if (!Array.isArray(cfg.sources)) throw new Error('Invalid config: sources must be an array');

  const seen = new Set();
  for (const s of cfg.sources) {
    if (!s || typeof s !== 'object') throw new Error('Invalid source: not an object');
    if (typeof s.id !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(s.id)) {
      throw new Error(`Invalid source id: ${s.id}`);
    }
    if (seen.has(s.id)) throw new Error(`Duplicate source id: ${s.id}`);
    seen.add(s.id);

    if (s.type !== 'openapi') throw new Error(`Invalid source type for ${s.id}: ${s.type}`);
    if (typeof s.location !== 'string' || !s.location) throw new Error(`Invalid location for ${s.id}`);
    if (typeof s.enabled !== 'boolean') throw new Error(`Invalid enabled for ${s.id}`);
  }
}

export function addOpenApiSource(cfg, { id, location, enabled = true }) {
  const next = structuredClone(cfg);
  next.sources = [...(next.sources ?? [])];
  next.sources.push({ id, type: 'openapi', location, enabled, addedAt: nowIso() });
  validateConfig(next);
  return next;
}
