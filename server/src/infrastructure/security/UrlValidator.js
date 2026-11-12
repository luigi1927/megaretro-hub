import { SecurityError } from './PathSanitizer.js';

const PRIVATE_IP_PATTERNS = [
    /^localhost$/i,
    /^127\./,
    /^10\./,
    /^192\.168\./,
    /^172\.(1[6-9]|2\d|3[0-1])\./,
    /^169\.254\./,
    /^0\.0\.0\.0$/,
    /^::1$/,
    /^fc00:/i,
    /^fe80:/i
];

export class UrlValidator {
    /**
     * Valida URLs externas evitando SSRF hacia redes internas o protocolos inseguros (Mitiga CWE-918).
     */
    static validateExternalHttpsUrl(rawUrl) {
        let parsed;
        try {
            parsed = new URL(rawUrl);
        } catch {
            throw new SecurityError('Formato de URL inválido', 'INVALID_URL');
        }

        if (parsed.protocol !== 'https:') {
            throw new SecurityError('Solo se permiten conexiones cifradas HTTPS', 'INSECURE_PROTOCOL');
        }

        const hostname = parsed.hostname;
        if (PRIVATE_IP_PATTERNS.some((regex) => regex.test(hostname))) {
            throw new SecurityError('Acceso bloqueado a direcciones de red interna (SSRF)', 'SSRF_BLOCKED');
        }

        return parsed.toString();
    }
}