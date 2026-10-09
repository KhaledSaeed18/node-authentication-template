import type { PrismaClient } from '../../generated/prisma/client.js';
import type { Mailer } from '../../mail/mailer.js';
import { AuthController } from './auth.controller.js';
import { createAuthRouter } from './auth.routes.js';
import { AuthService } from './auth.service.js';
import { VerificationCodeService } from './verification-code.service.js';

export interface AuthModuleDependencies {
    db: PrismaClient;
    mailer: Mailer;
}

// Composition root of the auth module
export const createAuthModule = ({ db, mailer }: AuthModuleDependencies) => {
    const service = new AuthService(db, mailer, new VerificationCodeService(db));
    return { service, router: createAuthRouter(new AuthController(service)) };
};
