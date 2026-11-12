import { PathSanitizer } from '../../infrastructure/security/PathSanitizer.js';

const ALLOWED_SYSTEMS = new Set([
    'NES', 'SNES', 'N64', 'GB', 'GBC', 'GBA', 'NDS',
    'GENESIS', 'DREAMCAST', 'PS1', 'PS2', 'PSP', 'GAMECUBE', 'WII', 'WIIU'
]);

const ALLOWED_EMULATORS = new Set(['retroarch', 'pcsx2', 'dolphin', 'cemu', 'ryujinx', 'xemu']);

export class Game {
    constructor({ id, title, system, year, sizeMB, emulator, core, coverUrl, executableFile }) {
        if (!id || !title || !executableFile) {
            throw new Error('Entidad Game incompleta: id, title y executableFile son obligatorios.');
        }

        const normalizedSystem = String(system).toUpperCase();
        if (!ALLOWED_SYSTEMS.has(normalizedSystem)) {
            throw new Error(`Sistema no soportado: ${system}`);
        }

        const normalizedEmulator = String(emulator).toLowerCase();
        if (!ALLOWED_EMULATORS.has(normalizedEmulator)) {
            throw new Error(`Emulador no permitido: ${emulator}`);
        }

        this.id = PathSanitizer.sanitizeSlug(id);
        this.title = String(title).trim().slice(0, 140);
        this.system = normalizedSystem;
        this.year = Number(year) || new Date().getFullYear();
        this.sizeMB = Math.max(0, Number(sizeMB) || 0);
        this.emulator = normalizedEmulator;
        this.core = core ? String(core).replace(/[^a-zA-Z0-9_.-]/g, '') : '';
        this.coverUrl = coverUrl || '';
        this.executableFile = String(executableFile);
    }
}