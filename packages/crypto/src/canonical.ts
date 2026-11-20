/**
 * Canonical JSON serializer (Part E1c)
 * Object keys sorted ascending, no whitespace, arrays in order,
 * numbers via JSON.stringify, no undefined (use null).
 * Runs identically in server and browser.
 */
export function canonicalJson(val: unknown): string {
  if (val === null || val === undefined) {
    return 'null';
  }
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return 'null';
    return JSON.stringify(val);
  }
  if (typeof val === 'boolean' || typeof val === 'string') {
    return JSON.stringify(val);
  }
  if (Array.isArray(val)) {
    return '[' + val.map((item) => canonicalJson(item === undefined ? null : item)).join(',') + ']';
  }
  if (typeof val === 'object') {
    const keys = Object.keys(val as Record<string, unknown>).sort();
    const parts = keys.map((key) => {
      const propVal = (val as Record<string, unknown>)[key];
      const serialized = canonicalJson(propVal === undefined ? null : propVal);
      return JSON.stringify(key) + ':' + serialized;
    });
    return '{' + parts.join(',') + '}';
  }
  return JSON.stringify(val);
}

