/**
 * A secret from the environment. Development falls back to the well-known
 * value from .env.example; production refuses to start with it missing or
 * still set to that value, since anyone could then forge tokens.
 */
export function secretEnv(name: string, devDefault: string): string {
  const value = process.env[name];
  if (process.env.NODE_ENV === "production" && (!value || value === devDefault)) {
    throw new Error(`${name} must be set to a private value in production`);
  }
  return value || devDefault;
}
