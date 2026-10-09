import { z } from 'zod';

export const SUPPORTED_SCOPES = ['openid', 'profile', 'email', 'offline_access'] as const;

// http is only accepted for loopback addresses, which native and local apps use
const isAllowedRedirectUri = (value: string) => {
    try {
        const url = new URL(value);
        if (url.hash) return false;
        if (url.protocol === 'https:') return true;
        return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    } catch {
        return false;
    }
};

export const createClientSchema = z.object({
    name: z.string().trim().min(1).max(100),
    redirectUris: z
        .array(z.string().refine(isAllowedRedirectUri, 'Must be an absolute https URL (http only for localhost), without a fragment'))
        .min(1)
        .max(10),
    scopes: z.array(z.enum(SUPPORTED_SCOPES)).min(1).default(['openid', 'profile', 'email']),
    // Confidential clients (server side) get a secret; public ones (SPA, mobile) rely on PKCE alone
    confidential: z.boolean().default(true),
    // Trusted first-party apps skip the consent step
    firstParty: z.boolean().default(false),
});

export const clientIdParamsSchema = z.object({ clientId: z.string().min(1).max(100) });
export const interactionParamsSchema = z.object({ interactionId: z.string().min(1).max(100) });

export const completeInteractionSchema = z.object({
    // Required for third-party clients the user hasn't approved yet
    consent: z.boolean().optional(),
});

export type CreateClientInput = z.infer<typeof createClientSchema>;
