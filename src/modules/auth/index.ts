import type { PrismaClient } from '../../generated/prisma/client.js';
import type { Mailer } from '../../mail/mailer.js';
import { AuthController } from './auth.controller.js';
import { createAuthRouter } from './auth.routes.js';
import { createAuthenticate } from '../../shared/middlewares/authenticate.js';
import { AuthService } from './auth.service.js';
import { SessionService } from './session.service.js';
import { VerificationCodeService } from './verification-code.service.js';

export interface AuthModuleDependencies {
    db: PrismaClient;
    mailer: Mailer;
}

// Composition root of the auth module
export const createAuthModule = ({ db, mailer }: AuthModuleDependencies) => {
    const sessions = new SessionService(db);
    const service = new AuthService(db, mailer, new VerificationCodeService(db), sessions);
    const authenticate = createAuthenticate(sessions);

    return { service, sessions, authenticate, router: createAuthRouter(new AuthController(service), authenticate) };
};
