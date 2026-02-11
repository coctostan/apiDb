#!/usr/bin/env node
import { Command } from 'commander';

import { findWorkspaceRoot } from './core/root.js';
import { initConfig, loadConfig, saveConfig, addOpenApiSource } from './core/config.js';
import { syncWorkspace } from './core/sync.js';
import { listSources } from './core/list.js';
import { searchDocs } from './core/search.js';
import { getDocById, renderDocHuman } from './core/show.js';
import { resolveOperationDocId, resolveSchemaDocId } from './core/exact.js';

const program = new Command();
program.name('apidb');

function commonRootOption(command) {
  return command.option('--root <path>', 'workspace root (overrides auto-discovery)');
}

commonRootOption(
  program
    .command('root')
    .description('print selected workspace root')
    .option('--verbose', 'print selection reason')
    .action(async (opts) => {
      const res = await findWorkspaceRoot({ cwd: process.cwd(), rootFlag: opts.root });
      process.stdout.write(`${res.root}\n`);
      if (opts.verbose) {
        process.stdout.write(`${res.reason}\n`);
      }
    })
);

commonRootOption(
  program
    .command('init')
    .description('initialize .apidb/config.json')
    .action(async (opts) => {
      const { root } = await findWorkspaceRoot({ cwd: process.cwd(), rootFlag: opts.root });
      await initConfig({ root });
      process.stdout.write(`Initialized ${root}/.apidb/config.json\n`);
    })
);

const addCommand = program.command('add').description('add a source');

commonRootOption(
  addCommand
    .command('openapi <location>')
    .requiredOption('--id <id>', 'source id')
    .option('--no-sync', 'do not sync immediately')
    .action(async (location, opts) => {
      const { root } = await findWorkspaceRoot({ cwd: process.cwd(), rootFlag: opts.root });
      await initConfig({ root });
      const cfg = await loadConfig({ root });
      const next = addOpenApiSource(cfg, { id: opts.id, location });
      await saveConfig({ root, config: next });
      process.stdout.write(`Added source ${opts.id}\n`);

      if (opts.sync !== false) {
        await syncWorkspace({ root, strict: true });
        process.stdout.write('Sync OK\n');
      }
    })
);

commonRootOption(
  program
    .command('sync')
    .description('sync enabled sources into local index')
    .option('--allow-partial', 'continue syncing other sources on failure')
    .option('--allow-private-net', 'allow fetching private network addresses')
    .action(async (opts) => {
      const { root } = await findWorkspaceRoot({ cwd: process.cwd(), rootFlag: opts.root });
      await syncWorkspace({
        root,
        strict: !opts.allowPartial,
        allowPrivateNet: !!opts.allowPrivateNet
      });
      process.stdout.write('Sync OK\n');
    })
);

commonRootOption(
  program
    .command('list')
    .description('list sources and sync status')
    .option('--json', 'machine-readable JSON')
    .action(async (opts) => {
      const { root } = await findWorkspaceRoot({ cwd: process.cwd(), rootFlag: opts.root });

      let res;
      try {
        res = listSources({ root });
      } catch (e) {
        if (/unable to open database file/i.test(String(e.message))) {
          const cfg = await loadConfig({ root });
          res = {
            sources: (cfg.sources ?? []).map((s) => ({
              ...s,
              status: null
            }))
          };
        } else {
          throw e;
        }
      }

      if (opts.json) {
        process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
        return;
      }

      for (const s of res.sources) {
        process.stdout.write(`${s.id}\t${s.enabled ? 'enabled' : 'disabled'}\t${s.location}\n`);
      }
    })
);

commonRootOption(
  program
    .command('search <query>')
    .description('search indexed docs')
    .option('--kind <kind>', 'operation|schema|any', 'any')
    .option('--source <id>', 'source id')
    .option('--limit <n>', 'limit (max 50)', '10')
    .option('--json', 'machine-readable JSON')
    .action(async (query, opts) => {
      const { root } = await findWorkspaceRoot({ cwd: process.cwd(), rootFlag: opts.root });
      const res = searchDocs({
        root,
        query,
        kind: opts.kind,
        sourceId: opts.source ?? null,
        limit: Number(opts.limit)
      });

      if (opts.json) {
        process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
        return;
      }

      for (const r of res.results) {
        process.stdout.write(`${r.id}\t${r.kind}\t${r.title}\t${r.sourceId}\n`);
      }
    })
);

commonRootOption(
  program
    .command('show <docId>')
    .description('show a document by doc id')
    .option('--json', 'machine-readable JSON')
    .action(async (docId, opts) => {
      const { root } = await findWorkspaceRoot({ cwd: process.cwd(), rootFlag: opts.root });
      const doc = await getDocById({ root, id: docId });
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(doc, null, 2)}\n`);
      } else {
        process.stdout.write(renderDocHuman(doc));
      }
    })
);

commonRootOption(
  program
    .command('op <method> <path>')
    .description('show operation doc by exact method/path/source')
    .option('--source <id>', 'source id')
    .option('--json', 'machine-readable JSON')
    .action(async (method, p, opts) => {
      const { root } = await findWorkspaceRoot({ cwd: process.cwd(), rootFlag: opts.root });
      const id = await resolveOperationDocId({ root, method, path: p, sourceId: opts.source ?? null });
      const doc = await getDocById({ root, id });
      if (opts.json) {
        process.stdout.write(`${JSON.stringify({ docId: id, doc }, null, 2)}\n`);
      } else {
        process.stdout.write(renderDocHuman(doc));
      }
    })
);

commonRootOption(
  program
    .command('schema <name>')
    .description('show schema doc by exact name/source')
    .option('--source <id>', 'source id')
    .option('--json', 'machine-readable JSON')
    .action(async (name, opts) => {
      const { root } = await findWorkspaceRoot({ cwd: process.cwd(), rootFlag: opts.root });
      const id = await resolveSchemaDocId({ root, schemaName: name, sourceId: opts.source ?? null });
      const doc = await getDocById({ root, id });
      if (opts.json) {
        process.stdout.write(`${JSON.stringify({ docId: id, doc }, null, 2)}\n`);
      } else {
        process.stdout.write(renderDocHuman(doc));
      }
    })
);

program.parseAsync(process.argv).catch((e) => {
  console.error(e.message);
  process.exit(1);
});
