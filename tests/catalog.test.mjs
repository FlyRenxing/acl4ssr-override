import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filenameToId } from '../scripts/lib/catalog.mjs';

describe('filenameToId', () => {
  it('maps known ACL4SSR names', () => {
    assert.equal(filenameToId('ACL4SSR.ini'), 'acl4ssr');
    assert.equal(filenameToId('ACL4SSR_Online_Full.ini'), 'online_full');
    assert.equal(filenameToId('ACL4SSR_Online_Full_AdblockPlus.ini'), 'online_full_adblock_plus');
    assert.equal(filenameToId('ACL4SSR_Online_Mini_Ai.ini'), 'online_mini_ai');
  });
});
