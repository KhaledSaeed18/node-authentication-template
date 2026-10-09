import { Router } from 'express';
import type { SigningKeyStore } from './signing-key.store.js';

// Public keys for verifying access tokens, in the standard JWKS format
export const createKeysRouter = (signingKeys: SigningKeyStore): Router => {
    const router = Router();

    router.get('/.well-known/jwks.json', async (_req, res) => {
        // Short cache: verifiers refetch when they see a kid they don't know yet
        res.set('Cache-Control', 'public, max-age=300');
        res.json(await signingKeys.jwks());
    });

    return router;
};
