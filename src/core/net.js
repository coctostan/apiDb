import dns from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';

function isPrivateIp(ip) {
  let addr;
  try {
    addr = ipaddr.parse(ip);
  } catch {
    return true;
  }

  if (addr.kind() === 'ipv6' && typeof addr.isIPv4MappedAddress === 'function' && addr.isIPv4MappedAddress()) {
    const mapped = addr.toIPv4Address();
    const mappedRange = mapped.range();
    return (
      mappedRange === 'private' ||
      mappedRange === 'loopback' ||
      mappedRange === 'linkLocal' ||
      mappedRange === 'carrierGradeNat'
    );
  }

  const range = addr.range();
  return (
    range === 'private' ||
    range === 'loopback' ||
    range === 'linkLocal' ||
    range === 'uniqueLocal' ||
    range === 'carrierGradeNat'
  );
}

export async function assertSafeHttpUrl(urlString, { allowPrivateNet = false } = {}) {
  const u = new URL(urlString);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Only http/https URLs are supported');
  }

  if (allowPrivateNet) return;

  const hostRaw = u.hostname;
  const host = hostRaw.startsWith('[') && hostRaw.endsWith(']') ? hostRaw.slice(1, -1) : hostRaw;

  if (host === 'localhost') {
    throw new Error('Refusing to fetch localhost URL');
  }

  if (isIP(host)) {
    if (isPrivateIp(host)) {
      throw new Error('Refusing to fetch private/loopback IP');
    }
    return;
  }

  const records = await dns.lookup(host, { all: true });
  for (const { address } of records) {
    if (isPrivateIp(address)) {
      throw new Error(`Refusing to fetch private/loopback address for host ${host}`);
    }
  }
}
