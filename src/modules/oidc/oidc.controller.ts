import type { Request, Response } from 'express';
import { currentUser } from '../../shared/middlewares/authenticate.js';
import { sendSuccess } from '../../shared/utils/response.js';
import type { ClientService } from './client.service.js';
import type { OidcService } from './oidc.service.js';

const requestContext = (req: Request) => ({ ipAddress: req.ip ?? null, userAgent: req.get('user-agent') ?? null });

// Token responses must not be cached (RFC 6749 5.1)
const noStore = (res: Response) => res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });

export class OidcController {
    constructor(
        private readonly oidc: OidcService,
        private readonly clients: ClientService
    ) {}

    discovery = (_req: Request, res: Response) => {
        res.set('Cache-Control', 'public, max-age=3600').json(this.oidc.discovery());
    };

    authorize = async (req: Request, res: Response) => {
        res.redirect(302, await this.oidc.authorize(req.query));
    };

    getInteraction = async (req: Request, res: Response) => {
        const interaction = await this.oidc.getInteraction(String(req.params.interactionId));
        sendSuccess(res, 200, 'Authorization request', { interaction });
    };

    completeInteraction = async (req: Request, res: Response) => {
        const { userId, sessionId } = currentUser(req);
        const result = await this.oidc.completeInteraction(String(req.params.interactionId), { userId, sessionId }, req.body.consent);
        sendSuccess(res, 200, 'Authorization request completed', result);
    };

    token = async (req: Request, res: Response) => {
        const tokens = await this.oidc.token(req.body ?? {}, req.get('authorization'), requestContext(req));
        noStore(res).json(tokens);
    };

    introspect = async (req: Request, res: Response) => {
        noStore(res).json(await this.oidc.introspect(req.body ?? {}, req.get('authorization')));
    };

    revoke = async (req: Request, res: Response) => {
        await this.oidc.revoke(req.body ?? {}, req.get('authorization'));
        noStore(res).status(200).end();
    };

    userinfo = async (req: Request, res: Response) => {
        noStore(res).json(await this.oidc.userinfo(req.get('authorization')));
    };

    createClient = async (req: Request, res: Response) => {
        const result = await this.clients.create(req.body);
        sendSuccess(res, 201, 'Client registered. The client secret is only shown once.', result);
    };

    listClients = async (_req: Request, res: Response) => {
        sendSuccess(res, 200, 'Clients fetched successfully', { clients: await this.clients.list() });
    };

    removeClient = async (req: Request, res: Response) => {
        await this.clients.remove(String(req.params.clientId));
        sendSuccess(res, 200, 'Client removed');
    };
}
