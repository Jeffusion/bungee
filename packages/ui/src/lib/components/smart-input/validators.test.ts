/**
 * Smart Input Validators Unit Tests
 * Tests for all validation functions used by smart-input components
 */

import { describe, test, expect } from 'bun:test';
import {
  validateUrl,
  validateNumber,
  validateRegex,
  validateExpression,
  validateCombo,
} from './validators';

// =============================================================================
// URL VALIDATION TESTS (UrlInput)
// =============================================================================

describe('validateUrl', () => {
  test('should accept valid URLs with protocol', () => {
    expect(validateUrl('https://example.com')).toBeNull();
    expect(validateUrl('http://localhost:3000')).toBeNull();
    expect(validateUrl('https://api.example.com/v1/users')).toBeNull();
    expect(validateUrl('http://192.168.1.1:8080/path')).toBeNull();
  });

  test('should accept URLs without protocol (auto-prepends https://)', () => {
    expect(validateUrl('example.com')).toBeNull();
    expect(validateUrl('api.example.com/v1')).toBeNull();
    expect(validateUrl('localhost:3000')).toBeNull();
  });

  test('should reject invalid URLs', () => {
    expect(validateUrl('not a url')).toBe('Invalid URL');
    expect(validateUrl('://missing-protocol')).toBe('Invalid URL');
    expect(validateUrl('http://')).toBe('Invalid URL');
  });

  test('should handle empty values based on required flag', () => {
    expect(validateUrl('', false)).toBeNull();
    expect(validateUrl('', true)).toBe('Required');
  });
});

// =============================================================================
// NUMBER VALIDATION TESTS (NumberInput)
// =============================================================================

describe('validateNumber', () => {
  test('should accept valid numbers', () => {
    expect(validateNumber(100)).toBeNull();
    expect(validateNumber(0)).toBeNull();
    expect(validateNumber(-50)).toBeNull();
    expect(validateNumber(3.14)).toBeNull();
    expect(validateNumber('42')).toBeNull();
  });

  test('should reject non-numeric values', () => {
    expect(validateNumber('abc')).toBe('Invalid number');
    expect(validateNumber('12abc')).toBe('Invalid number');
    expect(validateNumber(NaN)).toBe('Invalid number');
  });

  test('should enforce min constraint', () => {
    expect(validateNumber(5, { min: 0 })).toBeNull();
    expect(validateNumber(0, { min: 0 })).toBeNull();
    expect(validateNumber(-1, { min: 0 })).toBe('Min value: 0');
    expect(validateNumber(50, { min: 100 })).toBe('Min value: 100');
  });

  test('should enforce max constraint', () => {
    expect(validateNumber(50, { max: 100 })).toBeNull();
    expect(validateNumber(100, { max: 100 })).toBeNull();
    expect(validateNumber(101, { max: 100 })).toBe('Max value: 100');
    expect(validateNumber(1000, { max: 500 })).toBe('Max value: 500');
  });

  test('should enforce both min and max constraints', () => {
    expect(validateNumber(50, { min: 0, max: 100 })).toBeNull();
    expect(validateNumber(-1, { min: 0, max: 100 })).toBe('Min value: 0');
    expect(validateNumber(101, { min: 0, max: 100 })).toBe('Max value: 100');
  });

  test('should handle empty values based on required flag', () => {
    expect(validateNumber('', { required: false })).toBeNull();
    expect(validateNumber(null, { required: false })).toBeNull();
    expect(validateNumber(undefined, { required: false })).toBeNull();
    expect(validateNumber('', { required: true })).toBe('Required');
  });
});

// =============================================================================
// REGEX VALIDATION TESTS (RegexInput)
// =============================================================================

describe('validateRegex', () => {
  test('should accept valid regex patterns', () => {
    expect(validateRegex('^test$')).toBeNull();
    expect(validateRegex('\\d+')).toBeNull();
    expect(validateRegex('[a-zA-Z]+')).toBeNull();
    expect(validateRegex('.*')).toBeNull();
    expect(validateRegex('(foo|bar)')).toBeNull();
    expect(validateRegex('/api/v\\d+/.*')).toBeNull();
  });

  test('should reject invalid regex patterns', () => {
    expect(validateRegex('[')).not.toBeNull(); // Unclosed bracket
    expect(validateRegex('(')).not.toBeNull(); // Unclosed group
    expect(validateRegex('*')).not.toBeNull(); // Nothing to repeat
    expect(validateRegex('?')).not.toBeNull(); // Nothing to repeat
    expect(validateRegex('++')).not.toBeNull(); // Invalid quantifier
  });

  test('should handle empty values based on required flag', () => {
    expect(validateRegex('', false)).toBeNull();
    expect(validateRegex('', true)).toBe('Required');
  });
});

// =============================================================================
// EXPRESSION VALIDATION TESTS (ExpressionInput)
// =============================================================================

describe('validateExpression', () => {
  test('should accept valid expressions', () => {
    expect(validateExpression('{{ headers.Authorization }}')).toBeNull();
    expect(validateExpression('{{ body.userId }}')).toBeNull();
    expect(validateExpression('Bearer {{ env.API_KEY }}')).toBeNull();
    expect(validateExpression('{{ url.pathname }}')).toBeNull();
    expect(validateExpression('plain text without expressions')).toBeNull();
  });

  test('should accept multiple expressions', () => {
    expect(validateExpression('{{ headers.X-User }} - {{ body.name }}')).toBeNull();
    expect(validateExpression('prefix {{ a }} middle {{ b }} suffix')).toBeNull();
  });

  test('should reject unbalanced braces', () => {
    expect(validateExpression('{{ headers.Auth')).toBe('Unbalanced expression braces');
    expect(validateExpression('headers.Auth }}')).toBe('Unbalanced expression braces');
    expect(validateExpression('{{ a }} {{ b')).toBe('Unbalanced expression braces');
  });

  test('should reject empty expressions', () => {
    expect(validateExpression('{{ }}')).toBe('Empty expression');
    expect(validateExpression('{{  }}')).toBe('Empty expression');
    expect(validateExpression('prefix {{ }} suffix')).toBe('Empty expression');
  });

  test('should reject incomplete property access', () => {
    expect(validateExpression('{{ headers. }}')).toBe('Incomplete property access');
    expect(validateExpression('{{ body.user. }}')).toBe('Incomplete property access');
  });

  test('should handle empty values based on required flag', () => {
    expect(validateExpression('', false)).toBeNull();
    expect(validateExpression('', true)).toBe('Required');
  });
});

// =============================================================================
// COMBO VALIDATION TESTS (ComboInput)
// =============================================================================

describe('validateCombo', () => {
  const options = [
    { value: 'option1', label: 'Option 1' },
    { value: 'option2', label: 'Option 2' },
    { value: 'option3', label: 'Option 3' },
  ];

  test('should accept valid options', () => {
    expect(validateCombo('option1', options)).toBeNull();
    expect(validateCombo('option2', options)).toBeNull();
    expect(validateCombo('option3', options)).toBeNull();
  });

  test('should reject invalid options when allowCustom is false', () => {
    expect(validateCombo('invalid', options)).toBe('Invalid option');
    expect(validateCombo('option4', options)).toBe('Invalid option');
  });

  test('should accept custom values when allowCustom is true', () => {
    expect(validateCombo('custom-value', options, { allowCustom: true })).toBeNull();
    expect(validateCombo('anything', options, { allowCustom: true })).toBeNull();
  });

  test('should handle empty values based on required flag', () => {
    expect(validateCombo('', options, { required: false })).toBeNull();
    expect(validateCombo('', options, { required: true })).toBe('Required');
  });

  test('should handle empty options array', () => {
    expect(validateCombo('any', [])).toBe('Invalid option');
    expect(validateCombo('any', [], { allowCustom: true })).toBeNull();
  });
});

// =============================================================================
// EDGE CASES AND INTEGRATION TESTS
// =============================================================================

describe('Edge Cases', () => {
  test('validateUrl should handle special characters in URLs', () => {
    expect(validateUrl('https://example.com/path?query=value&foo=bar')).toBeNull();
    expect(validateUrl('https://example.com/path#anchor')).toBeNull();
    expect(validateUrl('https://user:pass@example.com')).toBeNull();
  });

  test('validateNumber should handle string numbers', () => {
    expect(validateNumber('100')).toBeNull();
    expect(validateNumber('3.14')).toBeNull();
    expect(validateNumber('-50')).toBeNull();
    expect(validateNumber('100', { min: 0, max: 200 })).toBeNull();
  });

  test('validateRegex should handle complex patterns', () => {
    expect(validateRegex('^(?=.*[A-Z])(?=.*[a-z])(?=.*\\d).{8,}$')).toBeNull(); // Password pattern
    expect(validateRegex('^[\\w.-]+@[\\w.-]+\\.\\w{2,}$')).toBeNull(); // Email pattern
    expect(validateRegex('^\\d{4}-\\d{2}-\\d{2}$')).toBeNull(); // Date pattern
  });

  test('validateExpression should handle nested property access', () => {
    expect(validateExpression('{{ body.user.profile.name }}')).toBeNull();
    expect(validateExpression('{{ headers["Content-Type"] }}')).toBeNull();
  });

  test('validators should be consistent with null vs error string return', () => {
    // All validators should return null for valid input
    expect(validateUrl('https://example.com')).toBeNull();
    expect(validateNumber(100)).toBeNull();
    expect(validateRegex('^test$')).toBeNull();
    expect(validateExpression('{{ test }}')).toBeNull();
    expect(validateCombo('option1', [{ value: 'option1' }])).toBeNull();

    // All validators should return string for invalid input
    expect(typeof validateUrl('invalid url')).toBe('string');
    expect(typeof validateNumber('abc')).toBe('string');
    expect(typeof validateRegex('[')).toBe('string');
    expect(typeof validateExpression('{{ }}')).toBe('string');
    expect(typeof validateCombo('invalid', [{ value: 'valid' }])).toBe('string');
  });
});
