import { describe, test, expect } from 'bun:test';
import {
  createStatusCodeMatcher,
  type StatusCodeRules
} from '../../src/worker/utils/status-code-matcher';

describe('StatusCodeMatcher', () => {
  test('exact match', () => {
    const matcher = createStatusCodeMatcher(500);
    expect(matcher(500)).toBe(true);
    expect(matcher(501)).toBe(false);
  });

  test('greater than or equal', () => {
    const matcher = createStatusCodeMatcher('>=400');
    expect(matcher(400)).toBe(true);
    expect(matcher(500)).toBe(true);
    expect(matcher(399)).toBe(false);
  });

  test('greater than', () => {
    const matcher = createStatusCodeMatcher('>499');
    expect(matcher(500)).toBe(true);
    expect(matcher(499)).toBe(false);
  });

  test('less than or equal', () => {
    const matcher = createStatusCodeMatcher('<=404');
    expect(matcher(404)).toBe(true);
    expect(matcher(405)).toBe(false);
  });

  test('less than', () => {
    const matcher = createStatusCodeMatcher('<500');
    expect(matcher(499)).toBe(true);
    expect(matcher(500)).toBe(false);
  });

  test('not equal', () => {
    const matcher = createStatusCodeMatcher('!200');
    expect(matcher(200)).toBe(false);
    expect(matcher(201)).toBe(true);
  });

  test('range match (4xx)', () => {
    const matcher = createStatusCodeMatcher('4xx');
    expect(matcher(400)).toBe(true);
    expect(matcher(499)).toBe(true);
    expect(matcher(500)).toBe(false);
  });

  test('range match (5xx)', () => {
    const matcher = createStatusCodeMatcher('5xx');
    expect(matcher(500)).toBe(true);
    expect(matcher(599)).toBe(true);
    expect(matcher(400)).toBe(false);
  });

  test('combined rules with comma string', () => {
    const matcher = createStatusCodeMatcher('>=400,!404');
    expect(matcher(400)).toBe(true);
    expect(matcher(500)).toBe(true);
    expect(matcher(404)).toBe(false);
  });

  test('combined rules with array input', () => {
    const rules: StatusCodeRules = ['5xx', '<=302'];
    const matcher = createStatusCodeMatcher(rules);
    expect(matcher(503)).toBe(true);
    expect(matcher(302)).toBe(true);
    expect(matcher(404)).toBe(false);
  });

  test('invalid rule throws error', () => {
    expect(() => createStatusCodeMatcher('abc')).toThrow('Invalid status code rule');
  });
});
