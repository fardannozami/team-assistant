import { z } from "zod";

export const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  PORT: z.coerce.number().default(4000),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(env: Record<string, string | undefined>): Env {
  return envSchema.parse(env);
}
