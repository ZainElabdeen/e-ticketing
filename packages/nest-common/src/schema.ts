/** adapter-pg ignores the `?schema=` URL parameter, so read it here; without it queries go to `public`. */
export function schemaOf(databaseUrl: string, fallback: string): string {
  try {
    return new URL(databaseUrl).searchParams.get('schema') ?? fallback;
  } catch {
    return fallback;
  }
}
