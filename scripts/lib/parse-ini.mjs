/**
 * Parse subconverter-style remote config INI into an AST.
 * Does not hardcode ACL4SSR group names.
 */

/**
 * @typedef {{ group: string, kind: 'url', url: string, interval?: number }} RulesetUrl
 * @typedef {{ group: string, kind: 'inline', literal: string }} RulesetInline
 * @typedef {RulesetUrl | RulesetInline} Ruleset
 * @typedef {{
 *   name: string,
 *   type: string,
 *   members: string[],
 *   filter: string | null,
 *   url?: string,
 *   interval?: number,
 *   tolerance?: number,
 *   raw: string,
 * }} ProxyGroup
 * @typedef {{
 *   exclude_remarks: string | null,
 *   rulesets: Ruleset[],
 *   proxy_groups: ProxyGroup[],
 *   flags: Record<string, string | boolean>,
 * }} IniAst
 */

/**
 * Strip surrounding quotes if present.
 * @param {string} s
 */
function unquote(s) {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

/**
 * @param {string} text
 * @returns {IniAst}
 */
export function parseIni(text) {
  /** @type {IniAst} */
  const ast = {
    exclude_remarks: null,
    rulesets: [],
    proxy_groups: [],
    flags: {},
  };

  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#') || line.startsWith('[')) {
      continue;
    }

    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const value = line.slice(eq + 1).trim();

    if (key === 'exclude_remarks') {
      ast.exclude_remarks = unquote(value);
      continue;
    }

    if (key === 'enable_rule_generator' || key === 'overwrite_original_rules') {
      ast.flags[key] = /^(true|1|yes)$/i.test(value);
      continue;
    }

    if (key === 'clash_rule_base') {
      ast.flags.clash_rule_base = value;
      continue;
    }

    if (key === 'ruleset') {
      const rs = parseRuleset(value);
      if (rs) ast.rulesets.push(rs);
      continue;
    }

    if (key === 'custom_proxy_group') {
      const g = parseProxyGroup(value);
      if (g) ast.proxy_groups.push(g);
      continue;
    }
  }

  return ast;
}

/**
 * @param {string} value
 * @returns {Ruleset | null}
 */
function parseRuleset(value) {
  // group,payload[,interval]
  const comma = value.indexOf(',');
  if (comma === -1) return null;
  const group = value.slice(0, comma).trim();
  let rest = value.slice(comma + 1).trim();

  // optional trailing interval: ,86400
  let interval;
  const intervalMatch = rest.match(/,(\d+)\s*$/);
  if (intervalMatch && !rest.includes('[]')) {
    // only strip trailing interval if not part of weird inline — subconverter uses ,interval after URL
    const before = rest.slice(0, intervalMatch.index);
    if (/^https?:\/\//i.test(before) || before.startsWith('clash-') || before.includes('://')) {
      interval = Number(intervalMatch[1]);
      rest = before.trim();
    }
  } else if (intervalMatch && /^https?:\/\//i.test(rest.slice(0, intervalMatch.index))) {
    interval = Number(intervalMatch[1]);
    rest = rest.slice(0, intervalMatch.index).trim();
  }

  // strip clash-domain: / clash-classical: prefixes for URL
  const prefixMatch = rest.match(/^(clash-[\w-]+):(https?:\/\/\S+)$/i);
  if (prefixMatch) {
    rest = prefixMatch[2];
  }

  if (rest.startsWith('[]')) {
    const literal = rest.slice(2).trim();
    // []GEOIP,CN  or []FINAL
    return { group, kind: 'inline', literal };
  }

  // Remote URL or subconverter local path (rules/ACL4SSR/...)
  if (/^https?:\/\//i.test(rest) || rest.startsWith('$') || isLocalRulesPath(rest)) {
    const m = rest.match(/^(https?:\/\/\S+?),(\d+)$/);
    if (m) {
      return { group, kind: 'url', url: m[1], interval: Number(m[2]) };
    }
    return { group, kind: 'url', url: rest, ...(interval != null ? { interval } : {}) };
  }

  // unknown payload — skip
  return null;
}

/**
 * subconverter ships ACL4SSR under rules/ACL4SSR/...
 * @param {string} s
 */
function isLocalRulesPath(s) {
  return /^(rules\/|\.\/rules\/)/i.test(s) || /\.list$/i.test(s) || /\.ya?ml$/i.test(s);
}

/**
 * @param {string} value
 * @returns {ProxyGroup | null}
 */
function parseProxyGroup(value) {
  // name`type`arg1`arg2`...
  const parts = value.split('`').map((p) => p.trim());
  if (parts.length < 2) return null;

  const name = parts[0];
  const type = (parts[1] || 'select').toLowerCase();
  const args = parts.slice(2);

  /** @type {string[]} */
  const members = [];
  /** @type {string | null} */
  let filter = null;
  let url;
  let interval;
  let tolerance;

  if (type === 'select') {
    for (const a of args) {
      if (!a) continue;
      if (a.startsWith('[]')) {
        members.push(a.slice(2));
      } else {
        // regex filter (e.g. .* or name pattern)
        filter = a;
      }
    }
  } else if (type === 'url-test' || type === 'fallback' || type === 'load-balance') {
    // Typical: filter`url`interval,tolerance
    // Or: []A`[]B`url`interval  (less common)
    const explicit = args.filter((a) => a.startsWith('[]'));
    const nonExplicit = args.filter((a) => a && !a.startsWith('[]'));

    for (const e of explicit) members.push(e.slice(2));

    if (nonExplicit.length) {
      // first non-url non-numeric-ish is filter
      let i = 0;
      if (nonExplicit[i] && !/^https?:\/\//i.test(nonExplicit[i]) && !/^\d/.test(nonExplicit[i])) {
        filter = nonExplicit[i];
        i++;
      }
      if (nonExplicit[i] && /^https?:\/\//i.test(nonExplicit[i])) {
        url = nonExplicit[i];
        i++;
      }
      if (nonExplicit[i]) {
        // subconverter: interval[,timeout][,tolerance] — e.g. 300,,50
        const nums = nonExplicit[i].split(',').map((x) => x.trim());
        if (nums[0] !== '') interval = Number(nums[0]) || undefined;
        const rest = nums.slice(1).filter((x) => x !== '');
        if (rest.length) {
          const tol = Number(rest[rest.length - 1]);
          if (!Number.isNaN(tol)) tolerance = tol;
        }
      }
    }
  } else {
    // unknown type: treat remaining as members/filter best-effort
    for (const a of args) {
      if (a.startsWith('[]')) members.push(a.slice(2));
      else if (a) filter = a;
    }
  }

  return {
    name,
    type,
    members,
    filter,
    url,
    interval,
    tolerance,
    raw: value,
  };
}
