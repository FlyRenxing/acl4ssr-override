/**
 * Validate IR before emit.
 * @param {object} ir
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
export function validate(ir) {
  const errors = [];
  const warnings = [];

  if (!ir || typeof ir !== 'object') {
    return { ok: false, errors: ['IR is empty'], warnings };
  }

  if (!Array.isArray(ir.groups) || ir.groups.length === 0) {
    errors.push('no proxy-groups');
  }

  if (!Array.isArray(ir.rules) || ir.rules.length === 0) {
    errors.push('no rules');
  }

  const groupNames = new Set((ir.groups || []).map((g) => g.name));
  const builtins = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE']);

  for (const g of ir.groups || []) {
    if (!g.name) errors.push('group missing name');
    if (!g.type) errors.push(`group ${g.name} missing type`);
    if (g.proxies) {
      for (const p of g.proxies) {
        if (!groupNames.has(p) && !builtins.has(p)) {
          // may be a leaf proxy name from subscription — only warn if looks like another group emoji style
          // referenced groups should exist; leaf proxy names are ok at runtime
          if (groupNames.size && looksLikeGroupRef(p) && !groupNames.has(p)) {
            warnings.push(`group "${g.name}" references unknown group "${p}"`);
          }
        }
      }
    }
  }

  const providerKeys = new Set(Object.keys(ir.providers || {}));
  for (const rule of ir.rules || []) {
    if (rule.startsWith('RULE-SET,')) {
      const parts = rule.split(',');
      const key = parts[1];
      const target = parts.slice(2).join(','); // group may contain commas? unlikely
      if (!providerKeys.has(key)) {
        errors.push(`RULE-SET references missing provider "${key}"`);
      }
      // target group should exist
      const group = parts[2];
      if (group && !groupNames.has(group) && !builtins.has(group)) {
        warnings.push(`rule targets unknown group "${group}": ${rule}`);
      }
    }
    if (rule.startsWith('MATCH,') || rule.startsWith('GEOIP,') || rule.startsWith('GEOSITE,')) {
      const parts = rule.split(',');
      const group = rule.startsWith('MATCH,')
        ? parts[1]
        : parts[2];
      if (group && group !== 'no-resolve' && !groupNames.has(group) && !builtins.has(group)) {
        warnings.push(`tail rule targets unknown group "${group}": ${rule}`);
      }
    }
  }

  // must end with MATCH ideally
  const last = (ir.rules || [])[(ir.rules || []).length - 1] || '';
  if (!last.startsWith('MATCH,')) {
    warnings.push('rules do not end with MATCH');
  }

  return { ok: errors.length === 0, errors, warnings };
}

function looksLikeGroupRef(name) {
  // heuristic: contains CJK or emoji presentation
  return /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(name) || /[\u4e00-\u9fff]/.test(name);
}
