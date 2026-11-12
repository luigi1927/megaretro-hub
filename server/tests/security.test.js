import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { PathSanitizer, SecurityError } from '../src/infrastructure/security/PathSanitizer.js';
import { UrlValidator } from '../src/infrastructure/security/UrlValidator.js';
import { RateLimiter } from '../src/infrastructure/security/RateLimiter.js';

describe('Suite de Seguridad (CWE Mitigation)', () => {
    it('debe permitir rutas válidas dentro del directorio base', () => {
        const base = path.resolve('/app/games');
        const safe = PathSanitizer.resolveInside(base, 'ps1', 'crash.chd');
        assert.equal(safe, path.join(base, 'ps1', 'crash.chd'));
    });

    it('debe bloquear intentos de Path Traversal (CWE-22)', () => {
        const base = path.resolve('/app/games');
        assert.throws(
            () => PathSanitizer.resolveInside(base, '../../Windows/System32/cmd.exe'),
            SecurityError
        );
    });

    it('debe bloquear SSRF hacia localhost e IPs privadas (CWE-918)', () => {
        assert.throws(() => UrlValidator.validateExternalHttpsUrl('http://127.0.0.1:8080/admin'), SecurityError);
        assert.throws(() => UrlValidator.validateExternalHttpsUrl('https://169.254.169.254/latest/meta-data'), SecurityError);
        assert.throws(() => UrlValidator.validateExternalHttpsUrl('https://192.168.1.1/config'), SecurityError);
    });

    it('debe permitir URLs HTTPS públicas válidas', () => {
        const valid = UrlValidator.validateExternalHttpsUrl('https://archive.org/details/psx-redump');
        assert.equal(valid, 'https://archive.org/details/psx-redump');
    });

    it('debe limitar exceso de peticiones por IP (Anti-DoS CWE-400)', () => {
        const limiter = new RateLimiter(2, 10_000);
        assert.equal(limiter.isAllowed('10.0.0.5'), true);
        assert.equal(limiter.isAllowed('10.0.0.5'), true);
        assert.equal(limiter.isAllowed('10.0.0.5'), false);
    });
});