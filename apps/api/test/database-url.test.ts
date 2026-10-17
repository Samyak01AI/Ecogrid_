import { describe, expect, it } from 'vitest';
import { databaseUrlForPrisma } from '../src/database-url.js';

describe('databaseUrlForPrisma', () => {
  it('adds strict TLS to MySQL URLs without dropping existing parameters', () => {
    const result = new URL(databaseUrlForPrisma('mysql', 'mysql://demo:secret@db.example:4000/ecogrid?ssl=true') ?? '');
    expect(result.searchParams.get('ssl')).toBe('true');
    expect(result.searchParams.get('sslaccept')).toBe('strict');
  });

  it('preserves an explicit MySQL certificate-validation policy', () => {
    const result = databaseUrlForPrisma('mysql', 'mysql://demo:secret@db.example:4000/ecogrid?sslaccept=accept_invalid_certs');
    expect(result).toContain('sslaccept=accept_invalid_certs');
  });

  it('does not modify PostgreSQL URLs', () => {
    const value = 'postgresql://demo:secret@localhost:5432/ecogrid?schema=public';
    expect(databaseUrlForPrisma('postgres', value)).toBe(value);
  });
});
