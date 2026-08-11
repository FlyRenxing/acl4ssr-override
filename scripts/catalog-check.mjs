#!/usr/bin/env node
/**
 * Compare local acl4ssr-catalog.yaml with GitHub tree (best-effort).
 * Exits 1 if catalog is missing files that exist upstream, or has extras (warn).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function fetchUpstreamNames() {
  // jsDelivr GitHub API-ish directory listing
  const url = 'https://cdn.jsdelivr.net/gh/ACL4SSR/ACL4SSR@master/Clash/config/';
  // jsDelivr doesn't list dirs well; try GitHub git trees via raw proxy
  const api = 'https://api.github.com/repos/ACL4SSR/ACL4SSR/contents/Clash/config';
  const res = await fetch(api, {
    headers: {
      'User-Agent': 'acl4ssr-override-catalog-check',
      Accept: 'application/vnd.github+json',
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} — try again later or update catalog manually`);
  }
  const data = await res.json();
  return data.filter((x) => x.type === 'file' && x.name.endsWith('.ini')).map((x) => x.name).sort();
}

async function main() {
  const catalogPath = path.join(ROOT, 'config', 'acl4ssr-catalog.yaml');
  const catalog = yaml.load(fs.readFileSync(catalogPath, 'utf8'));
  const local = new Set(catalog.files || []);

  let remote;
  try {
    remote = await fetchUpstreamNames();
  } catch (e) {
    console.warn('catalog:check skipped network:', e.message);
    process.exit(0);
  }

  const remoteSet = new Set(remote);
  const missing = remote.filter((f) => !local.has(f));
  const extra = [...local].filter((f) => !remoteSet.has(f));

  console.log(`local=${local.size} remote=${remote.length}`);
  if (missing.length) {
    console.error('Missing in catalog (add these):');
    for (const f of missing) console.error(' +', f);
  }
  if (extra.length) {
    console.warn('In catalog but not upstream (remove?):');
    for (const f of extra) console.warn(' -', f);
  }
  if (missing.length) process.exit(1);
  console.log('catalog OK');
}

main();
