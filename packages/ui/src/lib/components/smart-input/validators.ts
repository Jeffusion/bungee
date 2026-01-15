/**
 * Smart Input Validators
 * Pure validation functions extracted for testability
 */

/**
 * Validate URL format
 * Auto-prepends https:// if no protocol specified for validation
 */
export function validateUrl(val: string, required: boolean = false): string | null {
  if (!val && !required) return null;
  if (!val && required) return 'Required';

  try {
    let urlToCheck = val;
    if (!val.match(/^https?:\/\//)) {
      urlToCheck = 'https://' + val;
    }
    new URL(urlToCheck);
    return null;
  } catch (e) {
    return 'Invalid URL';
  }
}

/**
 * Validate number with optional min/max constraints
 */
export function validateNumber(
  val: any,
  options: { required?: boolean; min?: number; max?: number } = {}
): string | null {
  const { required = false, min, max } = options;

  if ((val === '' || val === null || val === undefined) && !required) return null;
  if ((val === '' || val === null || val === undefined) && required) return 'Required';

  const num = Number(val);
  if (isNaN(num)) {
    return 'Invalid number';
  }

  if (min !== undefined && num < min) {
    return `Min value: ${min}`;
  }

  if (max !== undefined && num > max) {
    return `Max value: ${max}`;
  }

  return null;
}

/**
 * Validate regex pattern
 */
export function validateRegex(val: string, required: boolean = false): string | null {
  if (!val && !required) return null;
  if (!val && required) return 'Required';

  try {
    new RegExp(val);
    return null;
  } catch (e: any) {
    return e.message || 'Invalid Regular Expression';
  }
}

/**
 * Validate expression syntax ({{ }} templates)
 */
export function validateExpression(val: string, required: boolean = false): string | null {
  if (!val && !required) return null;
  if (!val && required) return 'Required';

  // Check for unbalanced braces
  const openCount = (val.match(/\{\{/g) || []).length;
  const closeCount = (val.match(/\}\}/g) || []).length;

  if (openCount !== closeCount) {
    return 'Unbalanced expression braces';
  }

  // Check for empty expressions {{ }}
  if (/\{\{\s*\}\}/.test(val)) {
    return 'Empty expression';
  }

  // Check for unfinished property access like {{ headers. }}
  if (/\{\{[^}]*\.\s*\}\}/.test(val)) {
    return 'Incomplete property access';
  }

  return null;
}

/**
 * Validate combo input (select from options)
 */
export function validateCombo(
  val: any,
  options: { value: string }[],
  config: { required?: boolean; allowCustom?: boolean } = {}
): string | null {
  const { required = false, allowCustom = false } = config;

  if (!val && !required) return null;
  if (!val && required) return 'Required';

  if (!allowCustom) {
    const exists = options.some((o) => o.value === val);
    if (!exists) {
      return 'Invalid option';
    }
  }
  return null;
}
