import express, { type RequestHandler, Router } from 'express';
import { requireRole } from '../../shared/middlewares/authenticate.js';
import { createLimiter } from '../../shared/middlewares/rate-limit.js';
import { validate } from '../../shared/middlewares/validate.js';
import type { OidcController } from './oidc.controller.js';
import { oauthErrorHandler } from './oidc.errors.js';
import { clientIdParamsSchema, completeInteractionSchema, createClientSchema, interactionParamsSchema } from './oidc.schemas.js';

// Protocol endpoints, at the issuer's root (/.well-known/openid-configuration, /oauth/*)
export const createOidcRouter = (controller: OidcController, authenticate: RequestHandler): Router => {
    const router = Router();
    // Confidential clients call the token endpoint from their servers, often for many
    // users from one IP, so these limits are higher than the user-facing ones
    const protocolLimiter = createLimiter('oauth', 300);
    const formBody = express.urlencoded({ extended: false, limit: '10kb' });

    router.get('/.well-known/openid-configuration', controller.discovery);
    router.get('/oauth/authorize', createLimiter('oauth-authorize', 100), controller.authorize);
    router.get(
        '/oauth/interactions/:interactionId',
        protocolLimiter,
        validate(interactionParamsSchema, 'params'),
        controller.getInteraction
    );
    router.post(
        '/oauth/interactions/:interactionId/complete',
        protocolLimiter,
        authenticate,
        validate(interactionParamsSchema, 'params'),
        validate(completeInteractionSchema),
        controller.completeInteraction
    );
    router.post('/oauth/token', protocolLimiter, formBody, controller.token);
    router.get('/oauth/userinfo', protocolLimiter, controller.userinfo);
    router.post('/oauth/userinfo', protocolLimiter, formBody, controller.userinfo);

    // OAuth errors in the RFC 6749 format; everything else goes to the global handler
    router.use(oauthErrorHandler);
    return router;
};

// Client registration, admin only, under the API prefix
export const createOidcAdminRouter = (controller: OidcController, authenticate: RequestHandler): Router => {
    const router = Router();
    router.use(createLimiter('oauth-clients', 100), authenticate, requireRole('ADMIN'));

    router.get('/', controller.listClients);
    router.post('/', validate(createClientSchema), controller.createClient);
    router.delete('/:clientId', validate(clientIdParamsSchema, 'params'), controller.removeClient);
    return router;
};
