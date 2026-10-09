import 'dotenv/config';
import { z } from 'zod';

const csv = z
    .string()
    .transform((value) => value.split(',').map((item) => item.trim()).filter(Boolean));

const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    BASE_URL: z.string().default('/api'),
    API_VERSION: z.string().default('v1'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    DATABASE_URL: z.url(),

    SALT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),

    CORS_ORIGINS: csv.default(['http://localhost:3000']),
    // Express "trust proxy" setting: false, true, a hop count, or a list of IPs/subnets
    TRUST_PROXY: z
        .string()
        .default('false')
        .transform((value): boolean | number | string => {
            if (value === 'true') return true;
            if (value === 'false') return false;
            if (/^\d+$/.test(value)) return Number(value);
            return value;
        }),

    USER_EMAIL: z.string().optional(),
    CLIENT_ID: z.string().optional(),
    CLIENT_SECRET: z.string().optional(),
    REFRESH_TOKEN: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
    console.error('Invalid environment configuration:\n' + z.prettifyError(parsed.error));
    process.exit(1);
}

export const env: Env = parsed.data;
export const isProduction = env.NODE_ENV === 'production';
