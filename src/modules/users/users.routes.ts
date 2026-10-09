import { type RequestHandler, Router } from 'express';
import { requireRole } from '../../shared/middlewares/authenticate.js';
import { createLimiter } from '../../shared/middlewares/rate-limit.js';
import { validate } from '../../shared/middlewares/validate.js';
import { paginationQuerySchema } from '../../shared/validation/pagination.js';
import type { UsersController } from './users.controller.js';
import { deleteAccountSchema } from '../auth/auth.schemas.js';
import { updateProfileSchema, userIdParamsSchema } from './users.schemas.js';

export const createUsersRouter = (controller: UsersController, authenticate: RequestHandler): Router => {
    const router = Router();

    router.use(createLimiter('users', 100), authenticate);

    router.get('/me', controller.getMe);
    router.patch('/me', validate(updateProfileSchema), controller.updateMe);
    router.delete('/me', validate(deleteAccountSchema), controller.deleteMe);
    router.get('/me/activity', validate(paginationQuerySchema, 'query'), controller.myActivity);
    router.get('/me/export', createLimiter('users-export', 5), controller.exportMe);

    // Admin only
    router.get('/', requireRole('ADMIN'), validate(paginationQuerySchema, 'query'), controller.list);
    router.get(
        '/:userId/activity',
        requireRole('ADMIN'),
        validate(userIdParamsSchema, 'params'),
        validate(paginationQuerySchema, 'query'),
        controller.userActivity
    );

    return router;
};
