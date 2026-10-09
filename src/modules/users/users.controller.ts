import type { Request, Response } from 'express';
import { currentUser } from '../../shared/middlewares/authenticate.js';
import { sendSuccess } from '../../shared/utils/response.js';
import type { PaginationQuery } from '../../shared/validation/pagination.js';
import type { SecurityEventsService } from '../audit/security-events.js';
import type { AuthService } from '../auth/auth.service.js';
import type { UsersService } from './users.service.js';

export class UsersController {
    constructor(
        private readonly usersService: UsersService,
        private readonly securityEvents: SecurityEventsService,
        private readonly authService: AuthService
    ) {}

    exportMe = async (req: Request, res: Response) => {
        const data = await this.usersService.exportData(currentUser(req).userId);
        res.set('Content-Disposition', 'attachment; filename="account-data.json"');
        res.set('Cache-Control', 'no-store');
        res.json(data);
    };

    deleteMe = async (req: Request, res: Response) => {
        await this.authService.deleteAccount(currentUser(req).userId, req.body, {
            ipAddress: req.ip ?? null,
            userAgent: req.get('user-agent') ?? null,
        });
        sendSuccess(res, 200, 'Your account has been deleted');
    };

    getMe = async (req: Request, res: Response) => {
        const user = await this.usersService.getProfile(currentUser(req).userId);
        sendSuccess(res, 200, 'Profile fetched successfully', { user });
    };

    updateMe = async (req: Request, res: Response) => {
        const user = await this.usersService.updateProfile(currentUser(req).userId, req.body);
        sendSuccess(res, 200, 'Profile updated successfully', { user });
    };

    myActivity = async (req: Request, res: Response) => {
        const page = await this.securityEvents.list(currentUser(req).userId, req.query as unknown as PaginationQuery);
        sendSuccess(res, 200, 'Account activity fetched successfully', { events: page.items, nextCursor: page.nextCursor });
    };

    userActivity = async (req: Request, res: Response) => {
        const userId = String(req.params.userId);
        await this.usersService.getProfile(userId); // 404 for unknown users
        const page = await this.securityEvents.list(userId, req.query as unknown as PaginationQuery);
        sendSuccess(res, 200, 'Account activity fetched successfully', { events: page.items, nextCursor: page.nextCursor });
    };

    list = async (req: Request, res: Response) => {
        const page = await this.usersService.list(req.query as unknown as PaginationQuery);
        sendSuccess(res, 200, 'Users fetched successfully', { users: page.items, nextCursor: page.nextCursor });
    };
}
