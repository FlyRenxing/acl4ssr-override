import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseIni } from '../scripts/lib/parse-ini.mjs';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('parseIni', () => {
  it('parses Online Full fixture', () => {
    const text = fs.readFileSync(path.join(fixtures, 'ACL4SSR_Online_Full.ini'), 'utf8');
    const ast = parseIni(text);
    assert.ok(ast.rulesets.length > 10);
    assert.ok(ast.proxy_groups.length > 10);
    assert.ok(ast.rulesets.some((r) => r.kind === 'url'));
    assert.ok(ast.rulesets.some((r) => r.kind === 'inline' && /GEOIP|FINAL|MATCH/i.test(r.literal)));
    const auto = ast.proxy_groups.find((g) => g.name.includes('自动选择'));
    assert.ok(auto);
    assert.equal(auto.type, 'url-test');
  });

  it('parses Mini with fewer groups than Full', () => {
    const full = parseIni(fs.readFileSync(path.join(fixtures, 'ACL4SSR_Online_Full.ini'), 'utf8'));
    const mini = parseIni(fs.readFileSync(path.join(fixtures, 'ACL4SSR_Online_Mini.ini'), 'utf8'));
    assert.ok(mini.proxy_groups.length < full.proxy_groups.length);
    assert.ok(mini.rulesets.length < full.rulesets.length);
  });

  it('ignores commented ruleset lines', () => {
    const text = `
ruleset=A,https://example.com/a.list
;ruleset=B,https://example.com/b.list
ruleset=C,[]FINAL
`;
    const ast = parseIni(text);
    assert.equal(ast.rulesets.length, 2);
    assert.equal(ast.rulesets[0].group, 'A');
    assert.equal(ast.rulesets[1].literal, 'FINAL');
  });

  it('parses select with explicit members', () => {
    const text = `custom_proxy_group=🚀 节点选择\`select\`[]♻️ 自动选择\`[]DIRECT`;
    const ast = parseIni(text);
    assert.equal(ast.proxy_groups.length, 1);
    assert.deepEqual(ast.proxy_groups[0].members, ['♻️ 自动选择', 'DIRECT']);
  });

  it('parses url-test interval,,tolerance', () => {
    const text =
      'custom_proxy_group=🇭🇰 香港节点`url-test`(港|HK)`http://www.gstatic.com/generate_204`300,,50';
    const ast = parseIni(text);
    const g = ast.proxy_groups[0];
    assert.equal(g.type, 'url-test');
    assert.equal(g.filter, '(港|HK)');
    assert.equal(g.interval, 300);
    assert.equal(g.tolerance, 50);
  });
});
