import type { NextFunction, Request, Response } from 'express';
import { logger } from '../../lib/logger.js';

// OAuth 2.0 / OpenID Connect errors (RFC 6749 section 5.2). The OAuth endpoints answer
// in this format rather than the API's usual envelope, because client libraries expect it.
export class OAuthError extends Error {
    constructor(
        public readonly error: string,
        public readonly description: string,
        public readonly status = 400
    ) {
        super(description);
    }
}

export const invalidRequest = (description: string) => new OAuthError('invalid_request', description);
export const invalidGrant = (description: string) => new OAuthError('invalid_grant', description);
export const invalidClient = () => new OAuthError('invalid_client', 'Client authentication failed', 401);

export const oauthErrorHandler = (err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (!(err instanceof OAuthError)) return next(err);

    if (err.status === 401) {
        // RFC 6749: tell clients using HTTP Basic how to authenticate; RFC 6750 for bearer tokens
        const scheme = req.path.endsWith('/userinfo') ? 'Bearer error="invalid_token"' : 'Basic realm="oauth"';
        res.set('WWW-Authenticate', scheme);
    }
    logger.debug({ error: err.error, description: err.description }, 'OAuth error');
    res.status(err.status).set('Cache-Control', 'no-store').json({ error: err.error, error_description: err.description });
};
