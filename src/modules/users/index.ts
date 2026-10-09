import type { RequestHandler } from 'express';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { UsersController } from './users.controller.js';
import { createUsersRouter } from './users.routes.js';
import { UsersService } from './users.service.js';
import { SecurityEventsService } from '../audit/security-events.js';
import type { AuthService } from '../auth/auth.service.js';

export const createUsersModule = ({
    db,
    authenticate,
    authService,
}: {
    db: PrismaClient;
    authenticate: RequestHandler;
    authService: AuthService;
}) => {
    const service = new UsersService(db);
    return {
        service,
        router: createUsersRouter(new UsersController(service, new SecurityEventsService(db), authService), authenticate),
    };
};
