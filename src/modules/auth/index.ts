import { prisma } from '../../lib/prisma.js';
import { AuthController } from './auth.controller.js';
import { createAuthRouter } from './auth.routes.js';
import { AuthService } from './auth.service.js';

// Composition root of the auth module
export const authService = new AuthService(prisma);
export const authRouter = createAuthRouter(new AuthController(authService));
