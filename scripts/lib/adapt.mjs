/**
 * Adapt INI AST → IR for emitters.
 * No hardcoding of business group names.
 */

import path from 'node:path';

/**
 * @param {string} name
 */
export function slugify(name) {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\u4e00-\u9fff]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase()
    .replace(/[^\w]/g, '')
    .slice(0, 40) || 'g';
}

/**
 * @param {string} url
 * @param {string} group
 * @param {Map<string, number>} keyCount
 */
function providerKey(url, group, keyCount) {
  const base = path.basename(url).replace(/\.[^.]+$/, '') || 'rules';
  const filePart = base.replace(/[^\w.-]/g, '_').replace(/_+/g, '_');
  const prefix = slugify(group).replace(/[^\w]/g, '').slice(0, 24) || 'rs';
  let key = `${prefix}_${filePart}`.replace(/_+/g, '_');
  if (!/^[A-Za-z_]/.test(key)) key = `r_${key}`;

  if (!keyCount.has(key)) {
    keyCount.set(key, 0);
    return key;
  }
  const n = keyCount.get(key) + 1;
  keyCount.set(key, n);
  return `${key}_${n}`;
}

/**
 * Merge exclude_remarks into include-all filter as negative lookahead.
 * @param {string | null | undefined} existingFilter
 * @param {string} excludePattern without (?i) prefix preferred
 */
export function mergeExcludeFilter(existingFilter, excludePattern) {
  if (!excludePattern) return existingFilter || null;
  const bare = excludePattern.replace(/^\(\?i\)/, '');
  const neg = `(?!.*(?:${bare}))`;
  if (!existingFilter) {
    return `(?i)^${neg}.*`;
  }
  if (/^\(\?i\)\^/.test(existingFilter)) {
    return existingFilter.replace(/^\(\?i\)\^/, `(?i)^${neg}`);
  }
  if (/^\^/.test(existingFilter)) {
    return existingFilter.replace(/^\^/, `(?i)^${neg}`);
  }
  return `${neg}${existingFilter}`;
}

/**
 * Map subconverter local rules paths to fetchable URLs.
 * rules/ACL4SSR/Clash/Foo.list → raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Foo.list
 * @param {string} url
 */
export function resolveRulesetUrl(url) {
  if (!url) return url;
  if (/^https?:\/\//i.test(url) || url.startsWith('$')) return url;
  const m = url.match(/^(?:\.\/)?rules\/ACL4SSR\/(.+)$/i);
  if (m) {
    return `https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/${m[1]}`;
  }
  return url;
}

/**
 * Infer rule-provider behavior/format from URL.
 * @param {string} url
 */
function inferProviderFormat(url) {
  if (/\.ya?ml(\?|$)/i.test(url)) {
    return { behavior: 'classical', format: 'yaml' };
  }
  // ACL4SSR .list files are classical text rule lines
  return { behavior: 'classical', format: 'text' };
}

/**
 * @param {import('./parse-ini.mjs').IniAst} ast
 * @param {object} options from resolveProfileOptions
 * @param {object} meta { profileId, iniUrl, sha256 }
 */
export function adapt(ast, options, meta = {}) {
  const adaptOpts = options.adapt || {};
  const keyCount = new Map();
  /** @type {Record<string, object>} */
  const providers = {};
  /** @type {string[]} */
  const rules = [];

  const excludeFromIni = ast.exclude_remarks || '';
  const excludeFromOpt = options.exclude_remarks || '';
  // Prefer overlay exclude; fall back to ini
  const excludeRemarks = excludeFromOpt || excludeFromIni;

  for (const rs of ast.rulesets) {
    if (rs.kind === 'url') {
      let url = resolveRulesetUrl(rs.url);
      if (options.mirror_prefix && /^https?:\/\//i.test(url)) {
        url = options.mirror_prefix.replace(/\/$/, '') + '/' + url.replace(/^https?:\/\//, '');
      }
      const key = providerKey(rs.url, rs.group, keyCount);
      const fmt = inferProviderFormat(url);
      const ext = fmt.format === 'yaml' ? 'yaml' : 'list';
      const interval = rs.interval ?? options.provider_interval ?? 86400;
      const prefix = (options.ruleset_path_prefix || './ruleset/acl4ssr').replace(/\/$/, '');
      providers[key] = {
        type: 'http',
        behavior: fmt.behavior,
        format: fmt.format,
        url,
        path: `${prefix}/${key}.${ext}`,
        interval,
      };
      rules.push(`RULE-SET,${key},${rs.group}`);
    } else if (rs.kind === 'inline') {
      let lit = rs.literal.trim();
      // []FINAL → MATCH
      if (/^FINAL$/i.test(lit) && adaptOpts.final_as_match !== false) {
        lit = 'MATCH';
      }
      if (/^GEOIP[,:]/i.test(lit)) {
        // GEOIP,CN or GEOIP,CN,no-resolve
        const parts = lit.split(',');
        const code = parts[1] || 'CN';
        const noResolve = adaptOpts.geoip_no_resolve !== false;
        rules.push(
          noResolve
            ? `GEOIP,${code},${rs.group},no-resolve`
            : `GEOIP,${code},${rs.group}`
        );
      } else if (/^GEOSITE[,:]/i.test(lit)) {
        const parts = lit.split(',');
        const code = parts.slice(1).join(',') || parts[0];
        rules.push(`GEOSITE,${code},${rs.group}`);
      } else if (/^MATCH$/i.test(lit) || /^FINAL$/i.test(lit)) {
        rules.push(`MATCH,${rs.group}`);
      } else {
        // e.g. DOMAIN-SUFFIX,xxx already full? rare
        rules.push(`${lit},${rs.group}`);
      }
    }
  }

  const groups = ast.proxy_groups.map((pg) => {
    let type = pg.type;
    const supported = new Set(['select', 'url-test', 'fallback', 'load-balance']);
    if (!supported.has(type)) {
      type = 'select';
    }

    /** @type {Record<string, any>} */
    const g = {
      name: pg.name,
      type,
    };

    const hasMembers = pg.members && pg.members.length > 0;
    const hasFilter = pg.filter != null && pg.filter !== '';

    if (hasMembers) {
      g.proxies = [...pg.members];
    }

    // filter-only, or select with members+.* (subconverter: explicit + all proxies)
    if (adaptOpts.filter_groups_include_all !== false) {
      if (hasFilter && !hasMembers) {
        g['include-all'] = true;
        g.filter = pg.filter === '.*' ? null : pg.filter;
      } else if (hasFilter && hasMembers) {
        g['include-all'] = true;
        g.filter = pg.filter === '.*' ? null : pg.filter;
      } else if (!hasMembers && !hasFilter && type === 'select') {
        g.proxies = g.proxies || [];
      }
    } else if (hasFilter) {
      g.filter = pg.filter;
    }

    if (type === 'url-test' || type === 'fallback' || type === 'load-balance') {
      g.url = pg.url || 'http://www.gstatic.com/generate_204';
      g.interval = pg.interval ?? 300;
      if (pg.tolerance != null && !Number.isNaN(pg.tolerance)) {
        g.tolerance = pg.tolerance;
      } else if (type === 'url-test') {
        g.tolerance = 50;
      }
      // url-test with filter and no members → include-all
      if (!hasMembers && hasFilter) {
        g['include-all'] = true;
      }
      // url-test with no filter and no members → include all proxies
      if (!hasMembers && !hasFilter) {
        g['include-all'] = true;
      }
    }

    if (g['include-all'] && adaptOpts.inject_exclude_into_include_all !== false && excludeRemarks) {
      g.filter = mergeExcludeFilter(g.filter || null, excludeRemarks);
    }
    // drop null filter key
    if (g.filter == null) delete g.filter;

    return g;
  });

  return {
    meta: {
      profileId: meta.profileId,
      iniUrl: meta.iniUrl,
      sha256: meta.sha256,
      generatedAt: new Date().toISOString(),
      source: 'subconverter-ini',
    },
    excludeRemarks,
    sortProxies: options.sort_proxies !== false,
    sortProxiesLocale: options.sort_proxies_locale || 'zh-CN',
    dns: options.dns ?? null,
    hosts: options.hosts ?? null,
    general: options.general ?? null,
    stashMeta: options.stash || {},
    groups,
    providers,
    rules,
  };
}
