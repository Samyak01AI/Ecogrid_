export function databaseUrlForPrisma(provider: 'mysql' | 'postgres', value: string | undefined): string | undefined {
  if (!value || provider === 'postgres') return value;
  const url = new URL(value);
  if (!url.searchParams.has('sslaccept')) url.searchParams.set('sslaccept', 'strict');
  return url.toString();
}
