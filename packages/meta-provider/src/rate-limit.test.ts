import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseMetaRateLimitHeaders } from './rate-limit.js';

describe('parseMetaRateLimitHeaders', () => {
  it('parses X-Business-Use-Case-Usage and prefers pages type', () => {
    const buc = {
      '10153848260347724': [
        {
          type: 'ads_insights',
          call_count: 97,
          total_cputime: 23,
          total_time: 23,
          estimated_time_to_regain_access: 0,
        },
      ],
      '66782684': [
        {
          type: 'pages',
          call_count: 82,
          total_cputime: 40,
          total_time: 55,
          estimated_time_to_regain_access: 19,
        },
      ],
    };
    const snap = parseMetaRateLimitHeaders({
      'X-Business-Use-Case-Usage': JSON.stringify(buc),
    });
    assert.equal(snap.source, 'buc');
    assert.equal(snap.type, 'pages');
    assert.equal(snap.callCount, 82);
    assert.equal(snap.maxUsagePercent, 82);
    assert.equal(snap.estimatedTimeToRegainAccessMin, 19);
    assert.equal(snap.businessObjectId, '66782684');
  });

  it('falls back to X-App-Usage', () => {
    const snap = parseMetaRateLimitHeaders({
      'x-app-usage': JSON.stringify({
        call_count: 28,
        total_time: 25,
        total_cputime: 90,
      }),
    });
    assert.equal(snap.source, 'app');
    assert.equal(snap.maxUsagePercent, 90);
    assert.equal(snap.totalCpuTime, 90);
  });

  it('returns none when headers missing', () => {
    const snap = parseMetaRateLimitHeaders({});
    assert.equal(snap.source, 'none');
    assert.equal(snap.maxUsagePercent, 0);
  });
});
