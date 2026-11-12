export function applySecurityHeaders(res, sessionToken = null) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; img-src 'self' https://thumbnails.libretro.com https://images.igdb.com https://placehold.co data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self';"
    );

    if (sessionToken) {
        res.setHeader('X-Session-Token', sessionToken);
    }
}