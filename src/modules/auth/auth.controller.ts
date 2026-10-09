import type { Request, Response } from 'express';
import { currentUser } from '../../shared/middlewares/authenticate.js';
import { sendSuccess } from '../../shared/utils/response.js';
import type { AuthService, RequestContext } from './auth.service.js';

const requestContext = (req: Request): RequestContext => ({
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
});

// HTTP layer only: read the validated request, call the service, shape the response.
// Errors bubble up to the error handler (Express 5 forwards rejected promises).
export class AuthController {
    constructor(private readonly authService: AuthService) {}

    signup = async (req: Request, res: Response) => {
        const user = await this.authService.signup(req.body);
        sendSuccess(res, 201, 'User registered successfully', { user });
    };

    signin = async (req: Request, res: Response) => {
        const result = await this.authService.signin(req.body, requestContext(req));

        if (result.requiresOtp) {
            res.status(200).json({
                status: 'pending',
                statusCode: 200,
                message: '2FA verification required',
                data: { requiresOtp: true, user: result.user },
            });
            return;
        }

        const { user, accessToken, refreshToken } = result;
        sendSuccess(res, 200, 'User signed in successfully', { user, accessToken, refreshToken });
    };

    getLoginHistory = async (req: Request, res: Response) => {
        const loginHistory = await this.authService.getLoginHistory(currentUser(req).userId);
        sendSuccess(res, 200, 'Login history fetched successfully', { loginHistory });
    };

    refreshAccessToken = async (req: Request, res: Response) => {
        const tokens = await this.authService.refresh(req.body.refreshToken);
        sendSuccess(res, 200, 'Tokens refreshed successfully', tokens);
    };

    verifyEmail = async (req: Request, res: Response) => {
        const user = await this.authService.verifyEmail(req.body);
        sendSuccess(res, 200, 'Email verified successfully', { user });
    };

    resendVerificationCode = async (req: Request, res: Response) => {
        await this.authService.resendVerificationCode(req.body.email);
        sendSuccess(res, 200, 'If the account exists and is not verified yet, a new code has been sent');
    };

    forgotPassword = async (req: Request, res: Response) => {
        await this.authService.forgotPassword(req.body.email);
        sendSuccess(res, 200, 'If an account exists for this email, a reset code has been sent');
    };

    resetPassword = async (req: Request, res: Response) => {
        await this.authService.resetPassword(req.body);
        sendSuccess(res, 200, 'Password reset successful');
    };

    setup2FA = async (req: Request, res: Response) => {
        const data = await this.authService.setup2FA(currentUser(req).userId);
        sendSuccess(res, 200, '2FA setup initiated', data);
    };

    verify2FA = async (req: Request, res: Response) => {
        await this.authService.verify2FA(currentUser(req).userId, req.body.token);
        sendSuccess(res, 200, '2FA enabled successfully');
    };

    signin2FA = async (req: Request, res: Response) => {
        const data = await this.authService.signin2FA(req.body, requestContext(req));
        sendSuccess(res, 200, 'User signed in successfully', data);
    };

    disable2FA = async (req: Request, res: Response) => {
        await this.authService.disable2FA(currentUser(req).userId, req.body.token);
        sendSuccess(res, 200, '2FA disabled successfully');
    };
}
