import type { RequestHandler } from 'express';
import type { PrismaClient } from '../../generated/prisma/client.js';
import type { SessionService } from '../auth/session.service.js';
import type { AccessTokens } from '../auth/tokens.js';
import type { SigningKeyStore } from '../keys/signing-key.store.js';
import { ClientService } from './client.service.js';
import { OidcController } from './oidc.controller.js';
import { createOidcAdminRouter, createOidcRouter } from './oidc.routes.js';
import { OidcService } from './oidc.service.js';

interface OidcModuleDependencies {
    db: PrismaClient;
    sessions: SessionService;
    accessTokens: AccessTokens;
    signingKeys: SigningKeyStore;
    authenticate: RequestHandler;
}

export const createOidcModule = ({ db, sessions, accessTokens, signingKeys, authenticate }: OidcModuleDependencies) => {
    const clients = new ClientService(db);
    const controller = new OidcController(new OidcService(db, clients, sessions, accessTokens, signingKeys), clients);
    return {
        protocolRouter: createOidcRouter(controller, authenticate),
        adminRouter: createOidcAdminRouter(controller, authenticate),
    };
};
