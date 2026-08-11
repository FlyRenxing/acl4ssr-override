import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseIni } from '../scripts/lib/parse-ini.mjs';
import { adapt, mergeExcludeFilter, resolveRulesetUrl } from '../scripts/lib/adapt.mjs';
import { validate } from '../scripts/lib/validate.mjs';
import { emitStash } from '../scripts/lib/emit/stash.mjs';
import { emitParty } from '../scripts/lib/emit/party.mjs';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

const defaultOpts = {
  adapt: {
    filter_groups_include_all: true,
    inject_exclude_into_include_all: true,
    geoip_no_resolve: true,
    final_as_match: true,
  },
  exclude_remarks: '(?i)(流量|expire)',
  provider_interval: 86400,
  ruleset_path_prefix: './ruleset/acl4ssr',
  dns: { enable: true },
  stash: { name_template: 'T · {id}', desc_template: '{ini_url}' },
  general: { 'log-level': 'info' },
};

describe('adapt', () => {
  it('adapts Full fixture to valid IR', () => {
    const text = fs.readFileSync(path.join(fixtures, 'ACL4SSR_Online_Full.ini'), 'utf8');
    const ir = adapt(parseIni(text), defaultOpts, {
      profileId: 'online_full',
      iniUrl: 'https://example.com/full.ini',
      sha256: 'abc',
    });
    const v = validate(ir);
    assert.equal(v.ok, true, v.errors.join('; '));
    assert.ok(ir.rules.some((r) => r.startsWith('RULE-SET,')));
    assert.ok(ir.rules.some((r) => r.startsWith('GEOIP,')));
    assert.ok(ir.rules.at(-1).startsWith('MATCH,'));
    assert.ok(Object.keys(ir.providers).length > 5);
  });

  it('adapts Mini without code changes', () => {
    const text = fs.readFileSync(path.join(fixtures, 'ACL4SSR_Online_Mini.ini'), 'utf8');
    const ir = adapt(parseIni(text), defaultOpts, { profileId: 'online_mini', iniUrl: 'x', sha256: 'y' });
    assert.equal(validate(ir).ok, true);
  });

  it('picks up newly added ruleset/group without hardcoding', () => {
    const text = `
ruleset=🧪 测试组,https://example.com/custom-test.list
ruleset=🧪 测试组,[]FINAL
custom_proxy_group=🧪 测试组\`select\`[]DIRECT
custom_proxy_group=🚀 其它\`select\`[]DIRECT
`;
    const ir = adapt(parseIni(text), defaultOpts, { profileId: 't', iniUrl: 'u', sha256: 's' });
    assert.ok(ir.groups.some((g) => g.name === '🧪 测试组'));
    assert.ok(Object.values(ir.providers).some((p) => p.url.includes('custom-test.list')));
    assert.ok(ir.rules.some((r) => r.includes('测试组')));
  });

  it('FINAL becomes MATCH', () => {
    const text = `
ruleset=🐟 漏网之鱼,[]FINAL
custom_proxy_group=🐟 漏网之鱼\`select\`[]DIRECT
`;
    const ir = adapt(parseIni(text), defaultOpts, { profileId: 't', iniUrl: 'u', sha256: 's' });
    assert.ok(ir.rules.some((r) => r.startsWith('MATCH,')));
    assert.ok(!ir.rules.some((r) => /FINAL/i.test(r)));
  });

  it('include-all filter gets exclude injection', () => {
    const text = `
ruleset=A,[]FINAL
custom_proxy_group=A\`select\`[]DIRECT
custom_proxy_group=手动\`select\`.*
`;
    const ir = adapt(parseIni(text), defaultOpts, { profileId: 't', iniUrl: 'u', sha256: 's' });
    const manual = ir.groups.find((g) => g.name === '手动');
    assert.equal(manual['include-all'], true);
    assert.match(manual.filter, /流量|expire/);
  });
});

describe('mergeExcludeFilter', () => {
  it('prepends negative lookahead', () => {
    const f = mergeExcludeFilter('(?i)^(?=.*HK).*', 'expire|流量');
    assert.match(f, /\(\?!/);
    assert.match(f, /expire/);
  });
});

describe('resolveRulesetUrl', () => {
  it('rewrites subconverter local ACL4SSR paths', () => {
    assert.equal(
      resolveRulesetUrl('rules/ACL4SSR/Clash/BanAD.list'),
      'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/BanAD.list'
    );
  });
});

describe('local path rulesets', () => {
  it('turns rules/ACL4SSR paths into providers', () => {
    const text = `
ruleset=🛑 广告,rules/ACL4SSR/Clash/BanAD.list
ruleset=🐟 漏网之鱼,[]FINAL
custom_proxy_group=🛑 广告\`select\`[]REJECT
custom_proxy_group=🐟 漏网之鱼\`select\`[]DIRECT
`;
    const ir = adapt(parseIni(text), defaultOpts, { profileId: 't', iniUrl: 'u', sha256: 's' });
    assert.equal(Object.keys(ir.providers).length, 1);
    assert.match(Object.values(ir.providers)[0].url, /BanAD\.list$/);
  });
});

describe('emit', () => {
  it('stash has #!replace', () => {
    const text = fs.readFileSync(path.join(fixtures, 'ACL4SSR_Online_Mini.ini'), 'utf8');
    const ir = adapt(parseIni(text), defaultOpts, { profileId: 'online_mini', iniUrl: 'http://x', sha256: 's' });
    const out = emitStash(ir);
    assert.match(out, /proxy-groups: #!replace/);
    assert.match(out, /rule-providers: #!replace/);
    assert.match(out, /rules: #!replace/);
  });

  it('party exports main()', () => {
    const text = fs.readFileSync(path.join(fixtures, 'ACL4SSR_Online_Mini.ini'), 'utf8');
    const ir = adapt(parseIni(text), defaultOpts, { profileId: 'online_mini', iniUrl: 'http://x', sha256: 's' });
    const out = emitParty(ir);
    assert.match(out, /function main\(config\)/);
    assert.match(out, /proxy-groups/);
  });

  it('party sorts proxies by name when enabled', () => {
    const text = fs.readFileSync(path.join(fixtures, 'ACL4SSR_Online_Mini.ini'), 'utf8');
    const ir = adapt(
      parseIni(text),
      { ...defaultOpts, sort_proxies: true, sort_proxies_locale: 'zh-CN' },
      { profileId: 'online_mini', iniUrl: 'http://x', sha256: 's' }
    );
    const out = emitParty(ir);
    assert.match(out, /localeCompare/);
    assert.match(out, /sortLocale/);
  });
});
