import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import {
  __resetSendGateForTests,
  acquirePageSendSlot,
  cooldownMsFromMeta,
  pageCooldownRemainingMs,
  recordPageMetaUsage,
} from './send-gate.js';

describe('send-gate Meta pacing', () => {
  beforeEach(() => {
    __resetSendGateForTests();
  });

  it('uses Meta recover minutes when present', () => {
    const ms = cooldownMsFromMeta(
      {
        source: 'buc',
        maxUsagePercent: 100,
        estimatedTimeToRegainAccessMin: 2,
      },
      1
    );
    assert.ok(ms >= 120_000);
  });

  it('sets cooldown when usage hits hard threshold', async () => {
    const pageId = 'page_hard';
    const { cooldownMs } = await recordPageMetaUsage(pageId, {
      source: 'buc',
      maxUsagePercent: 95,
      type: 'pages',
      estimatedTimeToRegainAccessMin: 1,
    });
    assert.ok(cooldownMs > 0);
    const left = await pageCooldownRemainingMs(pageId);
    assert.ok(left > 0);
  });

  it('blocks acquire while cooled down', async () => {
    const pageId = 'page_cool';
    await recordPageMetaUsage(
      pageId,
      { source: 'buc', maxUsagePercent: 100, estimatedTimeToRegainAccessMin: 5 },
      { throttled: true }
    );
    await assert.rejects(
      () => acquirePageSendSlot(pageId, 500),
      (err: unknown) => {
        const e = err as Error & { status?: number; retryable?: boolean };
        assert.equal(e.status, 429);
        assert.equal(e.retryable, true);
        assert.match(e.message, /rate limit|cooled/i);
        return true;
      }
    );
  });

  it('allows acquire when not cooled', async () => {
    await acquirePageSendSlot('page_ok', 2000);
  });
});
