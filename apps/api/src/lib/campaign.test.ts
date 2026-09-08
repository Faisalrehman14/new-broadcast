import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  estimateQuotaUnits,
  findActiveCampaign,
  speedToDelayMs,
  PLAIN_UTILITY_TEMPLATE_NAME,
  STARTER_UTILITY_TEMPLATES,
} from './campaign.js';

describe('campaign helpers', () => {
  it('maps speed presets to delay', () => {
    assert.equal(speedToDelayMs('safe').delayMs, 500);
    assert.equal(speedToDelayMs('fast').delayMs, 150);
    assert.equal(speedToDelayMs('turbo').delayMs, 50);
    assert.equal(speedToDelayMs('custom', 250).delayMs, 250);
  });

  it('estimates quota units for text and image', () => {
    assert.equal(estimateQuotaUnits({ recipients: 10 }), 10);
    assert.equal(estimateQuotaUnits({ recipients: 10, hasImage: true }), 20);
    assert.equal(
      estimateQuotaUnits({ recipients: 10, hasImage: true, outside24hImageMode: true }),
      10
    );
  });

  it('exposes plain UTILITY + starters', () => {
    assert.equal(PLAIN_UTILITY_TEMPLATE_NAME, 'castme_plain_utility_v1');
    assert.ok(STARTER_UTILITY_TEMPLATES.length >= 3);
  });

  it('findActiveCampaign is exported', () => {
    assert.equal(typeof findActiveCampaign, 'function');
  });
});
