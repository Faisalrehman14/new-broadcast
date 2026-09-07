import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTemplateVariables,
  renderTemplatePreview,
  validateTemplateValues,
} from './index.js';

describe('parseTemplateVariables', () => {
  it('extracts ordered unique variables', () => {
    const result = parseTemplateVariables('Hi {{1}}, your {{2}} is ready. Thanks {{1}}!');
    assert.equal(result.variables.length, 2);
    assert.deepEqual(
      result.variables.map((v) => v.key),
      ['1', '2']
    );
    assert.deepEqual(result.duplicates, ['1']);
  });

  it('detects missing numbers', () => {
    const result = parseTemplateVariables('A {{1}} B {{3}}');
    assert.deepEqual(result.missingNumbers, [2]);
  });
});

describe('renderTemplatePreview', () => {
  it('substitutes values instantly', () => {
    const out = renderTemplatePreview('Hi {{1}} 👏 Your {{2}}', {
      '1': 'John',
      '2': 'Premium Plan',
    });
    assert.equal(out, 'Hi John 👏 Your Premium Plan');
  });
});

describe('validateTemplateValues', () => {
  it('requires all variables', () => {
    const result = validateTemplateValues('Hi {{1}}, {{2}}', { '1': 'A' });
    assert.equal(result.ok, false);
  });

  it('sanitizes and accepts valid values', () => {
    const result = validateTemplateValues('Hi {{1}}', { '1': '  John  ' });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.sanitized['1'], 'John');
  });
});
