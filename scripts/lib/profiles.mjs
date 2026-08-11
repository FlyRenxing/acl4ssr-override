import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { expandCatalog } from './catalog.mjs';

/**
 * @param {string} root repo root
 * @returns {{ defaults: object, profiles: object[] }}
 */
export function loadProfiles(root) {
  const profilesPath = path.join(root, 'config', 'profiles.yaml');
  const catalogPath = path.join(root, 'config', 'acl4ssr-catalog.yaml');

  const cfg = yaml.load(fs.readFileSync(profilesPath, 'utf8')) || {};
  const defaults = cfg.defaults || {};
  const byId = new Map();

  const presets = cfg.presets || {};
  if (presets.acl4ssr?.enabled !== false && presets.acl4ssr?.catalog !== false) {
    if (fs.existsSync(catalogPath)) {
      const catalog = yaml.load(fs.readFileSync(catalogPath, 'utf8'));
      let list = expandCatalog(catalog);
      const include = presets.acl4ssr.include;
      const exclude = new Set(presets.acl4ssr.exclude || []);
      if (Array.isArray(include) && include.length) {
        const want = new Set(include);
        list = list.filter((p) => want.has(p.filename));
      }
      list = list.filter((p) => !exclude.has(p.filename));
      for (const p of list) byId.set(p.id, { ...p });
    }
  }

  for (const p of cfg.profiles || []) {
    if (!p.id) throw new Error('explicit profile missing id');
    if (!p.ini_url) throw new Error(`profile ${p.id} missing ini_url`);
    byId.set(p.id, {
      source: 'explicit',
      enabled: p.enabled !== false,
      name: p.name || p.id,
      ...p,
    });
  }

  const profiles = [...byId.values()].filter((p) => p.enabled !== false);
  profiles.sort((a, b) => a.id.localeCompare(b.id));
  return { defaults, profiles };
}

/**
 * Deep-merge defaults with profile-level overrides for adapt/dns/etc.
 * @param {object} defaults
 * @param {object} profile
 */
export function resolveProfileOptions(defaults, profile) {
  return {
    targets: profile.targets || defaults.targets || ['stash', 'party'],
    adapt: { ...(defaults.adapt || {}), ...(profile.adapt || {}) },
    exclude_remarks: profile.exclude_remarks ?? defaults.exclude_remarks ?? '',
    provider_interval: profile.provider_interval ?? defaults.provider_interval ?? 86400,
    ruleset_path_prefix: profile.ruleset_path_prefix || defaults.ruleset_path_prefix || './ruleset/acl4ssr',
    dns: profile.dns !== undefined ? profile.dns : defaults.dns,
    hosts: profile.hosts !== undefined ? profile.hosts : defaults.hosts,
    general: { ...(defaults.general || {}), ...(profile.general || {}) },
    stash: { ...(defaults.stash || {}), ...(profile.stash || {}) },
    mirror_prefix: profile.mirror_prefix ?? defaults.mirror_prefix ?? '',
  };
}
