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
    RATE_LIMIT_ENABLED: z.stringbool().default(true),
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

    APP_NAME: z.string().default('Node Auth'),

    // Mail: "console" logs emails instead of sending them (handy in development)
    MAIL_TRANSPORT: z.enum(['console', 'smtp', 'gmail']).default('console'),
    MAIL_FROM: z.string().default('Node Auth <no-reply@example.com>'),

    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_SECURE: z.stringbool().default(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),

    GMAIL_USER: z.string().optional(),
    GMAIL_CLIENT_ID: z.string().optional(),
    GMAIL_CLIENT_SECRET: z.string().optional(),
    GMAIL_REFRESH_TOKEN: z.string().optional(),
}).superRefine((value, ctx) => {
    const requireFor = (transport: string, keys: (keyof typeof value)[]) => {
        if (value.MAIL_TRANSPORT !== transport) return;
        for (const key of keys) {
            if (!value[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required when MAIL_TRANSPORT=${transport}` });
        }
    };
    requireFor('smtp', ['SMTP_HOST']);
    requireFor('gmail', ['GMAIL_USER', 'GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN']);
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
    console.error('Invalid environment configuration:\n' + z.prettifyError(parsed.error));
    process.exit(1);
}

export const env: Env = parsed.data;
export const isProduction = env.NODE_ENV === 'production';
