/**
 * Status code matcher utility
 * Allows flexible expressions like 5xx, >=500, !404, etc.
 */

export type StatusCodeRules = number | string | Array<number | string>;

export type StatusCodeMatcher = (statusCode: number) => boolean;

/**
 * 创建状态码匹配器
 */
export function createStatusCodeMatcher(rules: StatusCodeRules): StatusCodeMatcher {
  const normalizedRules = normalizeRules(rules);

  if (normalizedRules.length === 0) {
    return () => false;
  }

  const matchers = normalizedRules.map((rule) => ({
    matcher: createSingleMatcher(rule),
    isNegation: rule.trim().startsWith('!'),
  }));

  return (statusCode: number) => {
    if (matchers.some((entry) => entry.isNegation && entry.matcher(statusCode))) {
      return false;
    }

    const positiveMatchers = matchers.filter((entry) => !entry.isNegation);
    if (positiveMatchers.length === 0) {
      return true;
    }

    return positiveMatchers.some((entry) => entry.matcher(statusCode));
  };
}

/**
 * 规范化规则，支持 number/string/数组输入
 */
function normalizeRules(rules: StatusCodeRules): string[] {
  const inputArray = Array.isArray(rules) ? rules : [rules];
  const normalized: string[] = [];

  inputArray.forEach((rule) => {
    if (rule === undefined || rule === null) {
      return;
    }

    if (typeof rule === 'number') {
      normalized.push(rule.toString());
      return;
    }

    if (typeof rule === 'string') {
      rule.split(',').forEach((part) => {
        const trimmed = part.trim();
        if (trimmed.length > 0) {
          normalized.push(trimmed);
        }
      });
    }
  });

  return normalized;
}

/**
 * 为单条规则创建匹配器
 */
function createSingleMatcher(rule: string): StatusCodeMatcher {
  const trimmed = rule.trim();
  if (!trimmed) {
    throw new Error('Status code rule cannot be empty');
  }

  const exactMatch = trimmed.match(/^(\d{3})$/);
  if (exactMatch) {
    const target = parseInt(exactMatch[1], 10);
    validateStatusCode(target, trimmed);
    return (code) => code === target;
  }

  const gteMatch = trimmed.match(/^>=\s*(\d{3})$/);
  if (gteMatch) {
    const threshold = parseInt(gteMatch[1], 10);
    validateStatusCode(threshold, trimmed);
    return (code) => code >= threshold;
  }

  const gtMatch = trimmed.match(/^>\s*(\d{3})$/);
  if (gtMatch) {
    const threshold = parseInt(gtMatch[1], 10);
    validateStatusCode(threshold, trimmed);
    return (code) => code > threshold;
  }

  const lteMatch = trimmed.match(/^<=\s*(\d{3})$/);
  if (lteMatch) {
    const threshold = parseInt(lteMatch[1], 10);
    validateStatusCode(threshold, trimmed);
    return (code) => code <= threshold;
  }

  const ltMatch = trimmed.match(/^<\s*(\d{3})$/);
  if (ltMatch) {
    const threshold = parseInt(ltMatch[1], 10);
    validateStatusCode(threshold, trimmed);
    return (code) => code < threshold;
  }

  const notMatch = trimmed.match(/^!\s*(\d{3})$/);
  if (notMatch) {
    const target = parseInt(notMatch[1], 10);
    validateStatusCode(target, trimmed);
    return (code) => code === target;
  }

  const rangeMatch = trimmed.match(/^([0-9])xx$/i);
  if (rangeMatch) {
    const startHundreds = parseInt(rangeMatch[1], 10);
    const start = startHundreds * 100;
    const end = start + 99;
    return (code) => code >= start && code <= end;
  }

  throw new Error(`Invalid status code rule: "${rule}"`);
}

function validateStatusCode(code: number, rule: string): void {
  if (code < 100 || code > 599) {
    throw new Error(`Status code in rule "${rule}" must be between 100 and 599`);
  }
}
