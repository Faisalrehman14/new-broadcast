import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyMetaSendError } from './meta-send-errors.js';

describe('classifyMetaSendError', () => {
  it('treats 551 / 1893047 as unavailable skip', () => {
    const err = new Error(
      'Meta send failed: 400 {"error":{"message":"This person isn\'t available right now.","code":551,"error_subcode":1893047}}'
    );
    const c = classifyMetaSendError(err);
    assert.equal(c.kind, 'recipient_unavailable');
    assert.equal(c.retryable, false);
    assert.equal(c.deactivateContact, true);
    assert.equal(c.reason, 'recipient_unavailable');
  });

  it('treats 100 / 2018001 as invalid PSID skip', () => {
    const err = Object.assign(new Error('Meta send failed: 400 {"error":{"message":"(#100) No matching user found","code":100,"error_subcode":2018001}}'), {
      code: 100,
      subcode: 2018001,
      status: 400,
    });
    const c = classifyMetaSendError(err);
    assert.equal(c.kind, 'recipient_invalid');
    assert.equal(c.retryable, false);
    assert.equal(c.deactivateContact, true);
  });

  it('retries rate limits', () => {
    const err = Object.assign(new Error('rate limited'), { status: 429, retryable: true });
    const c = classifyMetaSendError(err);
    assert.equal(c.retryable, true);
  });
});
