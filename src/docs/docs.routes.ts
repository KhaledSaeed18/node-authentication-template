import { apiReference } from '@scalar/express-api-reference';
import { Router } from 'express';
import helmet from 'helmet';
import { createOpenApiDocument } from './openapi.js';

// Serves the OpenAPI document and an interactive reference at /docs
export const createDocsRouter = (): Router => {
    const router = Router();
    const document = createOpenApiDocument();

    router.get('/docs/openapi.json', (_req, res) => {
        res.json(document);
    });

    // The reference UI loads its scripts from a CDN, so it gets its own, looser CSP
    router.use(
        '/docs',
        helmet({
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
                    styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://fonts.googleapis.com'],
                    fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net'],
                    imgSrc: ["'self'", 'data:', 'https:'],
                    connectSrc: ["'self'", 'https://cdn.jsdelivr.net'],
                    workerSrc: ["'self'", 'blob:'],
                },
            },
        }),
        apiReference({ url: '/docs/openapi.json', pageTitle: 'API Reference' })
    );

    return router;
};
