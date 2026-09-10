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
    assert.equal(c.reason, 'rate_limited');
  });

  it('retries Pages BUC 80001 and Platform 32', () => {
    const buc = Object.assign(
      new Error(
        'Meta send failed: 400 {"error":{"message":"(#80001) There have been too many calls to this Page account.","code":80001}}'
      ),
      { code: 80001, status: 400, retryable: true }
    );
    const c1 = classifyMetaSendError(buc);
    assert.equal(c1.retryable, true);
    assert.equal(c1.reason, 'rate_limited');

    const page = Object.assign(
      new Error(
        'Meta send failed: 400 {"error":{"message":"(#32) Page request limit reached","code":32}}'
      ),
      { code: 32, status: 400, retryable: true }
    );
    const c2 = classifyMetaSendError(page);
    assert.equal(c2.retryable, true);
    assert.equal(c2.reason, 'rate_limited');
  });

  it('treats 10/2018108 as unavailable, not outside window', () => {
    const err = Object.assign(
      new Error(
        'Meta send failed: 400 {"error":{"message":"(#10) This Person Cannot Receive Messages","code":10,"error_subcode":2018108}}'
      ),
      { code: 10, subcode: 2018108, status: 400 }
    );
    const c = classifyMetaSendError(err);
    assert.equal(c.kind, 'recipient_unavailable');
    assert.equal(c.deactivateContact, true);
  });

  it('treats 10/2018278 as outside window', () => {
    const err = Object.assign(
      new Error(
        'Meta send failed: 400 {"error":{"message":"(#10) This message is sent outside of allowed window.","code":10,"error_subcode":2018278}}'
      ),
      { code: 10, subcode: 2018278, status: 400 }
    );
    const c = classifyMetaSendError(err);
    assert.equal(c.kind, 'outside_window');
  });

  it('treats bare code 10 permission as utility permission missing', () => {
    const err = Object.assign(
      new Error(
        'Meta send failed: 400 {"error":{"message":"(#10) Application does not have permission for this action","code":10}}'
      ),
      { code: 10, status: 400 }
    );
    const c = classifyMetaSendError(err);
    assert.equal(c.kind, 'permission');
    assert.equal(c.reason, 'utility_permission_missing');
  });
});
