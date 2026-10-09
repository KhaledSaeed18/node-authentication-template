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

    JWT_ISSUER: z.string().default('node-auth'),
    JWT_AUDIENCE: z.string().default('node-auth-api'),
    // Lifetimes like 15m, 12h, 7d
    ACCESS_TOKEN_TTL: z.string().regex(/^\d+[smhd]$/, 'Use a number followed by s, m, h or d').default('15m'),
    REFRESH_TOKEN_TTL: z.string().regex(/^\d+[smhd]$/, 'Use a number followed by s, m, h or d').default('7d'),
    // Access tokens are signed with ES256 keys stored in the database; a new key is
    // created automatically once the current one is this old
    SIGNING_KEY_ROTATION_DAYS: z.coerce.number().int().positive().default(30),

    // 32 random bytes, base64 encoded (`openssl rand -base64 32`). Used to derive keys
    // for hashing one-time codes and encrypting 2FA secrets. Changing it invalidates both.
    ENCRYPTION_KEY: z
        .string()
        .refine((value) => Buffer.from(value, 'base64').length === 32, 'ENCRYPTION_KEY must be 32 bytes, base64 encoded'),

    CORS_ORIGINS: csv.default(['http://localhost:3000']),
    // Passkeys (WebAuthn): the relying party ID is the domain the passkeys are bound to
    // (e.g. example.com), the origins are the exact front-end origins allowed to use them
    WEBAUTHN_RP_ID: z.string().default('localhost'),
    WEBAUTHN_ORIGINS: csv.default(['http://localhost:3000']),
    RATE_LIMIT_ENABLED: z.stringbool().default(true),
    // Optional. When set, rate limit counters are shared by all instances through Redis
    REDIS_URL: z.url().optional(),
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
    // How long login history is kept by the cleanup job
    LOGIN_HISTORY_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
    // How long the account activity (security events) is kept
    SECURITY_EVENT_RETENTION_DAYS: z.coerce.number().int().positive().default(365),
    // Run the outbox worker inside the API process. Turn off when running dedicated
    // workers (node dist/scripts/worker.js) or in tests, which drain the outbox themselves.
    OUTBOX_WORKER_ENABLED: z.stringbool().default(true),
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(1000),
    // Interactive API docs at /docs. Defaults to on, except in production.
    API_DOCS_ENABLED: z.stringbool().optional(),

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
