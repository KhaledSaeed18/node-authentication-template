import type { PrismaClient } from '../../generated/prisma/client.js';
import type { Mailer } from '../../mail/mailer.js';
import { AuthController } from './auth.controller.js';
import { createAuthJobHandlers } from './auth.jobs.js';
import { createAuthRouter } from './auth.routes.js';
import { createAuthenticate } from '../../shared/middlewares/authenticate.js';
import { AuthService } from './auth.service.js';
import { PasskeyService } from './passkey.service.js';
import { RecoveryCodeService } from './recovery-code.service.js';
import { SessionService } from './session.service.js';
import { VerificationCodeService } from './verification-code.service.js';
import { AccessTokens } from './tokens.js';
import type { SigningKeyStore } from '../keys/signing-key.store.js';

export interface AuthModuleDependencies {
    db: PrismaClient;
    mailer: Mailer;
    signingKeys: SigningKeyStore;
}

// Composition root of the auth module
export const createAuthModule = ({ db, mailer, signingKeys }: AuthModuleDependencies) => {
    const sessions = new SessionService(db);
    const codes = new VerificationCodeService(db);
    const accessTokens = new AccessTokens(signingKeys);
    const service = new AuthService(db, codes, sessions, new RecoveryCodeService(db), new PasskeyService(db), accessTokens);
    const authenticate = createAuthenticate(accessTokens, sessions);

    return {
        service,
        sessions,
        accessTokens,
        authenticate,
        router: createAuthRouter(new AuthController(service), authenticate),
        // Background jobs this module defines, delivered by the outbox worker
        jobHandlers: createAuthJobHandlers({ db, mailer, codes }),
    };
};
