import type { Request, Response } from 'express';
import { currentUser } from '../../shared/middlewares/authenticate.js';
import { sendSuccess } from '../../shared/utils/response.js';
import type { PaginationQuery } from '../../shared/validation/pagination.js';
import type { UsersService } from './users.service.js';

export class UsersController {
    constructor(private readonly usersService: UsersService) {}

    getMe = async (req: Request, res: Response) => {
        const user = await this.usersService.getProfile(currentUser(req).userId);
        sendSuccess(res, 200, 'Profile fetched successfully', { user });
    };

    updateMe = async (req: Request, res: Response) => {
        const user = await this.usersService.updateProfile(currentUser(req).userId, req.body);
        sendSuccess(res, 200, 'Profile updated successfully', { user });
    };

    list = async (req: Request, res: Response) => {
        const page = await this.usersService.list(req.query as unknown as PaginationQuery);
        sendSuccess(res, 200, 'Users fetched successfully', { users: page.items, nextCursor: page.nextCursor });
    };
}
