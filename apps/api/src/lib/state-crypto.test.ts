import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { canTransitionBroadcast } from '@pagebroadcast/types';

const KEY = Buffer.from(
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  'hex'
);

function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

function decryptSecret(payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(':');
  assert.equal(version, 'v1');
  const decipher = createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivB64!, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64!, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64!, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

describe('broadcast state machine', () => {
  it('allows DRAFT → PENDING_APPROVAL', () => {
    assert.equal(canTransitionBroadcast('DRAFT', 'PENDING_APPROVAL'), true);
  });

  it('blocks COMPLETED → RUNNING', () => {
    assert.equal(canTransitionBroadcast('COMPLETED', 'RUNNING'), false);
  });
});

describe('crypto', () => {
  it('roundtrips secrets', () => {
    const token = 'EAAG_test_token_value';
    const encrypted = encryptSecret(token);
    assert.ok(encrypted.startsWith('v1:'));
    assert.equal(decryptSecret(encrypted), token);
  });

  it('hashes tokens stably', () => {
    const h = (t: string) => createHash('sha256').update(t).digest('hex');
    assert.equal(h('abc'), h('abc'));
    assert.notEqual(h('abc'), h('abd'));
  });
});
