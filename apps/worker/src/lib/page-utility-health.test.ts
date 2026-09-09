import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { grantUtilityForPage } from './page-utility-health.js';

describe('grantUtilityForPage', () => {
  it('returns false when utility scope missing', () => {
    assert.equal(grantUtilityForPage({ scopes: ['pages_messaging'] }, '111'), false);
  });

  it('returns true when granular targets include the page', () => {
    assert.equal(
      grantUtilityForPage(
        {
          scopes: ['pages_utility_messaging'],
          granular_scopes: [
            { scope: 'pages_utility_messaging', target_ids: ['111', '222'] },
          ],
        },
        '111'
      ),
      true
    );
  });

  it('returns false when granular targets omit the page', () => {
    assert.equal(
      grantUtilityForPage(
        {
          scopes: ['pages_utility_messaging'],
          granular_scopes: [{ scope: 'pages_utility_messaging', target_ids: ['222'] }],
        },
        '111'
      ),
      false
    );
  });

  it('returns null when scope present without granular targets', () => {
    assert.equal(
      grantUtilityForPage({ scopes: ['pages_utility_messaging'], granular_scopes: [] }, '111'),
      null
    );
  });
});
