import { type RequestHandler, Router } from 'express';
import { requireRole } from '../../shared/middlewares/authenticate.js';
import { createLimiter } from '../../shared/middlewares/rate-limit.js';
import { validate } from '../../shared/middlewares/validate.js';
import { paginationQuerySchema } from '../../shared/validation/pagination.js';
import type { UsersController } from './users.controller.js';
import { updateProfileSchema } from './users.schemas.js';

export const createUsersRouter = (controller: UsersController, authenticate: RequestHandler): Router => {
    const router = Router();

    router.use(createLimiter(100), authenticate);

    router.get('/me', controller.getMe);
    router.patch('/me', validate(updateProfileSchema), controller.updateMe);

    // Admin only
    router.get('/', requireRole('ADMIN'), validate(paginationQuerySchema, 'query'), controller.list);

    return router;
};
