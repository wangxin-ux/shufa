export function redactMainEvidence(value: unknown): unknown {
  if (value instanceof AggregateError)
    return {
      name: value.name,
      message: redactMainEvidence(value.message),
      errors: (value.errors as unknown[]).map(redactMainEvidence),
      cause: redactMainEvidence(value.cause),
    };
  if (value instanceof Error)
    return {
      name: value.name,
      message: redactMainEvidence(value.message),
      cause: redactMainEvidence(value.cause),
    };
  if (typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return value.map(redactMainEvidence);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /token|secret|password|authorization|connectionString/i.test(key)
          ? '[REDACTED]'
          : redactMainEvidence(item),
      ]),
    );
  if (typeof value === 'string')
    return value
      .replace(/\bpostgres(?:ql)?:\/\/[^\s"'<>]+/gi, '[REDACTED_POSTGRES_URL]')
      .replace(
        /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
        '[REDACTED_JWT]',
      );
  return value;
}
