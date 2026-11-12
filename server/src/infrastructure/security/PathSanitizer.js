import path from 'node:path';

export class SecurityError extends Error {
    constructor(message, code = 'SECURITY_VIOLATION') {
        super(message);
        this.name = 'SecurityError';
        this.code = code;
    }
}

export class PathSanitizer {
    /**
     * Garantiza que targetPath permanezca estrictamente dentro de baseDir (Mitiga CWE-22).
     */
    static resolveInside(baseDir, ...segments) {
        const resolvedBase = path.resolve(baseDir);
        const resolvedTarget = path.resolve(resolvedBase, ...segments);

        if (
            resolvedTarget !== resolvedBase &&
            !resolvedTarget.startsWith(resolvedBase + path.sep)
        ) {
            throw new SecurityError(
                `Intento de Path Traversal bloqueado: ${segments.join('/')}`,
                'PATH_TRAVERSAL'
            );
        }
        return resolvedTarget;
    }

    /**
     * Sanitiza nombres de archivos o identificadores eliminando caracteres peligrosos.
     */
    static sanitizeSlug(input) {
        if (typeof input !== 'string' || !input.trim()) {
            throw new SecurityError('Identificador inválido', 'INVALID_INPUT');
        }
        const clean = input
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, '')
            .slice(0, 80);

        if (!clean) {
            throw new SecurityError('El identificador quedó vacío tras sanitizar', 'INVALID_INPUT');
        }
        return clean;
    }
}