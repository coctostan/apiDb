import test from 'node:test';
import assert from 'node:assert/strict';

import { assertSafeHttpUrl } from '../src/core/net.js';

test('assertSafeHttpUrl: rejects localhost', async () => {
  await assert.rejects(() => assertSafeHttpUrl('http://localhost:1234/x'), /private|loopback|localhost/i);
});

test('assertSafeHttpUrl: allows public https URL', async () => {
  await assertSafeHttpUrl('https://example.com/openapi.json');
});

test('assertSafeHttpUrl: rejects IPv4-mapped loopback', async () => {
  await assert.rejects(
    () => assertSafeHttpUrl('http://[::ffff:127.0.0.1]/openapi.json'),
    /private|loopback/i
  );
});
