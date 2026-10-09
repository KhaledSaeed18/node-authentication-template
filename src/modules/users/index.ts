import type { RequestHandler } from 'express';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { UsersController } from './users.controller.js';
import { createUsersRouter } from './users.routes.js';
import { UsersService } from './users.service.js';
import { SecurityEventsService } from '../audit/security-events.js';

export const createUsersModule = ({ db, authenticate }: { db: PrismaClient; authenticate: RequestHandler }) => {
    const service = new UsersService(db);
    return {
        service,
        router: createUsersRouter(new UsersController(service, new SecurityEventsService(db)), authenticate),
    };
};
