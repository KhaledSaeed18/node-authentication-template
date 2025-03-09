import { Request, Response, NextFunction } from 'express';

// Security headers middleware
export const securityHeaders = (req: Request, res: Response, next: NextFunction) => {
    // Prevent browsers from detecting the MIME type
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Prevent XSS attacks
    res.setHeader('X-XSS-Protection', '1; mode=block');

    // Control how much information is included in referrer header
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'DENY');

    // Content Security Policy
    res.setHeader('Content-Security-Policy',
        "default-src 'self'; " +
        "script-src 'self'; " +
        "style-src 'self'; " +
        "img-src 'self' data:; " +
        "font-src 'self'; " +
        "connect-src 'self'; " +
        "frame-ancestors 'none';"
    );

    // HTTP Strict Transport Security
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');

    // Cross-Origin policies
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

    next();
};