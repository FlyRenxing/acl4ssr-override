#!/usr/bin/env node
/**
 * Batch: fetch subconverter INI profiles → Stash + Party overrides.
 *
 * Usage:
 *   node scripts/generate.mjs
 *   node scripts/generate.mjs --only online_full,online_mini
 *   node scripts/generate.mjs --offline
 *   node scripts/generate.mjs --strict
 *   node scripts/generate.mjs --concurrency 5
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadProfiles, resolveProfileOptions } from './lib/profiles.mjs';
import { fetchIni } from './lib/fetch.mjs';
import { parseIni } from './lib/parse-ini.mjs';
import { adapt } from './lib/adapt.mjs';
import { validate } from './lib/validate.mjs';
import { emitStash } from './lib/emit/stash.mjs';
import { emitParty } from './lib/emit/party.mjs';
import { writeIndex } from './lib/emit/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const opts = {
    only: null,
    offline: false,
    strict: false,
    concurrency: 5,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--offline') opts.offline = true;
    else if (a === '--strict') opts.strict = true;
    else if (a === '--only') opts.only = new Set((argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean));
    else if (a.startsWith('--only=')) opts.only = new Set(a.slice(7).split(',').map((s) => s.trim()).filter(Boolean));
    else if (a === '--concurrency') opts.concurrency = Math.max(1, Number(argv[++i]) || 5);
  }
  return opts;
}

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function processProfile(profile, defaults, cli) {
  const options = resolveProfileOptions(defaults, profile);
  const outDir = path.join(ROOT, 'output', profile.id);
  const cachePath = path.join(ROOT, '.cache', `${profile.id}.ini`);

  try {
    const { text, sha256, fromCache } = await fetchIni({
      url: profile.ini_url,
      cachePath,
      offline: cli.offline,
    });

    const ast = parseIni(text);
    const ir = adapt(ast, options, {
      profileId: profile.id,
      iniUrl: profile.ini_url,
      sha256,
    });
    const v = validate(ir);
    if (!v.ok) {
      throw new Error(`validate failed: ${v.errors.join('; ')}`);
    }
    for (const w of v.warnings) {
      console.warn(`[${profile.id}] warn: ${w}`);
    }

    fs.mkdirSync(path.join(outDir, 'stash'), { recursive: true });
    fs.mkdirSync(path.join(outDir, 'party'), { recursive: true });
    fs.writeFileSync(path.join(outDir, 'upstream.ini'), text, 'utf8');

    const targets = options.targets || ['stash', 'party'];
    const artifacts = [];

    if (targets.includes('stash')) {
      const body = emitStash(ir);
      const p = path.join(outDir, 'stash', 'override.stoverride');
      fs.writeFileSync(p, body, 'utf8');
      artifacts.push('stash/override.stoverride');
    }
    if (targets.includes('party')) {
      const body = emitParty(ir);
      const p = path.join(outDir, 'party', 'override.js');
      fs.writeFileSync(p, body, 'utf8');
      artifacts.push('party/override.js');
    }

    const meta = {
      id: profile.id,
      name: profile.name,
      ini_url: profile.ini_url,
      sha256,
      from_cache: fromCache,
      generated_at: ir.meta.generatedAt,
      group_count: ir.groups.length,
      provider_count: Object.keys(ir.providers).length,
      rules_count: ir.rules.length,
      artifacts,
      warnings: v.warnings,
    };
    fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');

    console.log(
      `✅ ${profile.id}  groups=${meta.group_count} providers=${meta.provider_count} rules=${meta.rules_count}${fromCache ? ' (cache)' : ''}`
    );
    return { status: 'ok', ...meta };
  } catch (err) {
    console.error(`❌ ${profile.id}: ${err.message}`);
    return {
      status: 'error',
      id: profile.id,
      name: profile.name,
      ini_url: profile.ini_url,
      error: err.message,
    };
  }
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  console.log('acl4ssr-override generate');
  console.log(`root: ${ROOT}`);

  const { defaults, profiles: all } = loadProfiles(ROOT);
  let profiles = all;
  if (cli.only) {
    profiles = all.filter((p) => cli.only.has(p.id));
    const missing = [...cli.only].filter((id) => !all.some((p) => p.id === id));
    if (missing.length) console.warn('unknown --only ids:', missing.join(', '));
  }

  console.log(`profiles: ${profiles.length}`);

  const results = await mapPool(profiles, cli.concurrency, (p) => processProfile(p, defaults, cli));

  // If --only, merge with previous index entries for other profiles
  const outRoot = path.join(ROOT, 'output');
  let merged = results;
  if (cli.only && fs.existsSync(path.join(outRoot, 'index.json'))) {
    try {
      const prev = JSON.parse(fs.readFileSync(path.join(outRoot, 'index.json'), 'utf8'));
      const byId = new Map((prev.profiles || []).map((x) => [x.id, x]));
      for (const r of results) byId.set(r.id, r);
      merged = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
    } catch {
      /* ignore */
    }
  }

  const index = writeIndex(outRoot, merged);
  console.log(`\nindex: ok=${index.ok} failed=${index.failed} total=${index.count}`);
  console.log(`wrote ${path.join(outRoot, 'index.json')}`);

  if (cli.strict && index.failed > 0) {
    process.exit(1);
  }
  if (index.ok === 0 && profiles.length > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
