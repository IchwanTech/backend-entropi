import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  STRIPE_MOCK_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0.05),
  // URL frontend yang diizinkan untuk mengakses backend (CORS). Pisahkan dengan koma untuk banyak origin.
  CORS_ORIGIN: z.string().default("*"),
});

const loadEnv = () => {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("Invalid environment variables:");
    console.error(result.error.flatten().fieldErrors);
    process.exit(1);
  }
  return result.data;
};

export const env = loadEnv();
export type Env = z.infer<typeof envSchema>;
