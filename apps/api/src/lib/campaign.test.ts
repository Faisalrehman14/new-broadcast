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
    assert.equal(speedToDelayMs('safe').delayMs, 600);
    assert.equal(speedToDelayMs('balanced').delayMs, 300);
    assert.equal(speedToDelayMs('fast').delayMs, 150);
    assert.equal(speedToDelayMs('turbo').delayMs, 80);
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
    assert.ok(STARTER_UTILITY_TEMPLATES.length >= 20);
    assert.ok(STARTER_UTILITY_TEMPLATES.some((t) => t.name.startsWith('pi_')));
    assert.ok(STARTER_UTILITY_TEMPLATES.some((t) => t.name === 'membership_status_update'));
    assert.ok(STARTER_UTILITY_TEMPLATES.some((t) => t.title === 'Template-27'));
    assert.ok(STARTER_UTILITY_TEMPLATES.every((t) => !t.instant));
  });

  it('findActiveCampaign is exported', () => {
    assert.equal(typeof findActiveCampaign, 'function');
  });
});
