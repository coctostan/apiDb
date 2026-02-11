import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { join } from 'node:path';

const WORKFLOW_PATH = join(import.meta.dirname, '..', '.github', 'workflows', 'ci.yml');

describe('CI workflow', () => {
  let wf;

  it('should be valid YAML', () => {
    const raw = readFileSync(WORKFLOW_PATH, 'utf8');
    wf = parse(raw);
    assert.ok(wf, 'parsed YAML is truthy');
  });

  it('triggers on push to main and pull_request', () => {
    const raw = readFileSync(WORKFLOW_PATH, 'utf8');
    wf = parse(raw);
    assert.ok(wf.on.push, 'has push trigger');
    assert.deepStrictEqual(wf.on.push.branches, ['main']);
    assert.ok('pull_request' in wf.on, 'has pull_request trigger');
  });

  it('uses ubuntu-latest runner', () => {
    const raw = readFileSync(WORKFLOW_PATH, 'utf8');
    wf = parse(raw);
    const job = wf.jobs.ci ?? wf.jobs.test ?? Object.values(wf.jobs)[0];
    assert.strictEqual(job['runs-on'], 'ubuntu-latest');
  });

  it('has checkout, setup-node@v4 with node 20.x + npm cache, npm ci, npm test, smoke-test steps', () => {
    const raw = readFileSync(WORKFLOW_PATH, 'utf8');
    wf = parse(raw);
    const job = wf.jobs.ci ?? wf.jobs.test ?? Object.values(wf.jobs)[0];
    const steps = job.steps;

    // checkout
    const checkout = steps.find(s => s.uses && s.uses.startsWith('actions/checkout'));
    assert.ok(checkout, 'has checkout step');

    // setup-node@v4
    const setupNode = steps.find(s => s.uses && s.uses.startsWith('actions/setup-node@v4'));
    assert.ok(setupNode, 'has setup-node@v4 step');
    assert.strictEqual(setupNode.with['node-version'], '20.x');
    assert.strictEqual(setupNode.with.cache, 'npm');

    // npm ci
    const npmCi = steps.find(s => s.run && s.run.includes('npm ci'));
    assert.ok(npmCi, 'has npm ci step');

    // npm test
    const npmTest = steps.find(s => s.run && s.run.includes('npm test'));
    assert.ok(npmTest, 'has npm test step');

    // smoke-test
    const smoke = steps.find(s => s.run && s.run.includes('scripts/smoke-test.sh'));
    assert.ok(smoke, 'has smoke-test step');
  });
});
