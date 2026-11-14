import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..', '..');

// En modo escritorio (Electron) estas rutas llegan por variables de entorno:
// los emuladores y el frontend viven junto a la instalación, mientras que los
// juegos, el catálogo y las partidas se guardan en la carpeta de datos del
// usuario (LocalAppData) para sobrevivir a actualizaciones.
const PORT = Number(process.env.MEGARETRO_PORT) || 3333;
const PACKAGED = Boolean(process.env.MEGARETRO_PACKAGED);
const DATA_DIR = process.env.MEGARETRO_DATA_DIR
    ? path.resolve(process.env.MEGARETRO_DATA_DIR)
    : ROOT_DIR;

const CLIENT_DIST_DIR = process.env.MEGARETRO_CLIENT_DIR
    ? path.resolve(process.env.MEGARETRO_CLIENT_DIR)
    : path.join(ROOT_DIR, 'client', 'dist', 'client', 'browser');
const CLIENT_DIST_FALLBACK = path.resolve(CLIENT_DIST_DIR, '..');
const GAMES_DIR = process.env.MEGARETRO_GAMES_DIR
    ? path.resolve(process.env.MEGARETRO_GAMES_DIR)
    : path.join(DATA_DIR, 'games');
const EMULATORS_DIR = process.env.MEGARETRO_EMULATORS_DIR
    ? path.resolve(process.env.MEGARETRO_EMULATORS_DIR)
    : path.join(ROOT_DIR, 'emulators');
const CATALOG_PATH = process.env.MEGARETRO_CATALOG_PATH
    ? path.resolve(process.env.MEGARETRO_CATALOG_PATH)
    : path.join(ROOT_DIR, 'server', 'catalog.json');
const SOURCES_PATH = process.env.MEGARETRO_SOURCES_PATH
    ? path.resolve(process.env.MEGARETRO_SOURCES_PATH)
    : path.join(ROOT_DIR, 'server', 'sources.json');
const CONFIG_TEMPLATES_DIR = path.join(EMULATORS_DIR, '.config');
const DOWNLOADS_DIR = process.env.MEGARETRO_DOWNLOADS_DIR
    ? path.resolve(process.env.MEGARETRO_DOWNLOADS_DIR)
    : path.join(os.homedir(), 'Downloads');

// Configuración de PCSX2 en el perfil del usuario. PCSX2 no es portable por
// defecto: guarda memcards, BIOS y ajustes en Documentos\PCSX2.
const PCSX2_DATA_DIR = process.env.MEGARETRO_PCSX2_DIR
    ? path.resolve(process.env.MEGARETRO_PCSX2_DIR)
    : path.join(os.homedir(), 'Documents', 'PCSX2');
const PCSX2_BIOS_DIR = path.join(PCSX2_DATA_DIR, 'bios');
const PCSX2_INI_PATH = path.join(PCSX2_DATA_DIR, 'inis', 'PCSX2.ini');

const ARCHIVE_EXTS = ['.zip', '.7z'];

const EXT_PROFILES = {
    '.cue': { system: 'PS1', emulator: 'retroarch', core: 'swanstation_libretro.dll', dir: 'Sony - PlayStation' },
    '.chd': { system: 'PS1', emulator: 'retroarch', core: 'swanstation_libretro.dll', dir: 'Sony - PlayStation' },
    '.bin': { system: 'PS1', emulator: 'retroarch', core: 'swanstation_libretro.dll', dir: 'Sony - PlayStation' },
    '.gba': { system: 'GBA', emulator: 'retroarch', core: 'mgba_libretro.dll', dir: 'Nintendo - Game Boy Advance' },
    '.gbc': { system: 'GBC', emulator: 'retroarch', core: 'gambatte_libretro.dll', dir: 'Nintendo - Game Boy Color' },
    '.gb': { system: 'GB', emulator: 'retroarch', core: 'gambatte_libretro.dll', dir: 'Nintendo - Game Boy' },
    '.sfc': { system: 'SNES', emulator: 'retroarch', core: 'snes9x_libretro.dll', dir: 'Nintendo - Super Nintendo Entertainment System' },
    '.smc': { system: 'SNES', emulator: 'retroarch', core: 'snes9x_libretro.dll', dir: 'Nintendo - Super Nintendo Entertainment System' },
    '.nes': { system: 'NES', emulator: 'retroarch', core: 'nestopia_libretro.dll', dir: 'Nintendo - Nintendo Entertainment System' },
    '.n64': { system: 'N64', emulator: 'retroarch', core: 'mupen64plus_next_libretro.dll', dir: 'Nintendo - Nintendo 64' },
    '.z64': { system: 'N64', emulator: 'retroarch', core: 'mupen64plus_next_libretro.dll', dir: 'Nintendo - Nintendo 64' },
    '.nds': { system: 'NDS', emulator: 'retroarch', core: 'melonds_libretro.dll', dir: 'Nintendo - Nintendo DS' },
    '.md': { system: 'GENESIS', emulator: 'retroarch', core: 'genesis_plus_gx_libretro.dll', dir: 'Sega - Mega Drive - Genesis' },
    '.iso': { system: 'PS2', emulator: 'pcsx2', core: null, dir: 'Sony - PlayStation 2' },
    '.rvz': { system: 'GC', emulator: 'dolphin', core: null, dir: 'Nintendo - GameCube' }
};

const ROM_EXTS = new Set(Object.keys(EXT_PROFILES));

// Extensiones que pueden pertenecer a más de un sistema: manda el sistema
// elegido por el usuario (o el perfil por defecto si no hay ninguno).
const AMBIGUOUS_EXTS = new Set(['.iso', '.bin', '.img']);

// Extensiones cuyo sistema se puede corregir automáticamente sin ambigüedad.
const STRONG_SYSTEM_EXTS = new Set([...ROM_EXTS].filter((ext) => !AMBIGUOUS_EXTS.has(ext)));

// Archivos que NUNCA son un juego, aunque su extensión coincida (ej: README.md
// de un ZIP de documentación se interpretaba como ROM de Mega Drive).
const DOC_NAME_PATTERN = /(^|[\\/_.\-\s])(readme|licen[cs]e|copying|changelog|notice|manual|instructions?|credits|authors|contributors|docs?)([\\/_.\-\s]|$)/i;
const ROM_EXTRA_EXTS = new Set(['.m3u', '.img', '.sub', '.ccd', '.mds', '.mdf', '.toc', '.gcm']);

// Archivos que suelen estar en Descargas pero no son juegos.
const JUNK_DOWNLOAD_PATTERN = /(^|[\\/_.\-\s])(bios|firmware|speech|soundtrack|artwork|manual(?:es)?|readme|licen[cs]e|screenshots?|packshots?|docs?)([\\/_.\-\s]|$)/i;

// Tamaño mínimo razonable para considerar que un archivo es una ROM.
function minRomBytes(ext) {
    if (ext === '.md') return 131_072;
    if (ext === '.bin' || ext === '.iso') return 1_048_576;
    if (ext === '.cue') return 16;
    return 8_192;
}

const SYSTEM_COVER_DIR = {
    PS1: 'Sony - PlayStation',
    PS2: 'Sony - PlayStation 2',
    SNES: 'Nintendo - Super Nintendo Entertainment System',
    NES: 'Nintendo - Nintendo Entertainment System',
    N64: 'Nintendo - Nintendo 64',
    GB: 'Nintendo - Game Boy',
    GBC: 'Nintendo - Game Boy Color',
    GBA: 'Nintendo - Game Boy Advance',
    NDS: 'Nintendo - Nintendo DS',
    GENESIS: 'Sega - Mega Drive - Genesis',
    GC: 'Nintendo - GameCube'
};

// Un .md de documentación es texto plano; una ROM de Mega Drive es binaria.
async function looksLikeBinary(filePath) {
    try {
        const handle = await fsp.open(filePath, 'r');
        const buffer = Buffer.alloc(4096);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        await handle.close();
        if (bytesRead === 0) return false;

        let nonPrintable = 0;
        for (let i = 0; i < bytesRead; i++) {
            const byte = buffer[i];
            if (byte < 9 || (byte > 13 && byte < 32) || byte === 127) nonPrintable++;
        }
        return nonPrintable / bytesRead > 0.08;
    } catch {
        return false;
    }
}

async function isLikelyRomFile(filePath, ext) {
    const base = path.basename(filePath);
    if (DOC_NAME_PATTERN.test(base)) return false;

    const stat = await fsp.stat(filePath).catch(() => null);
    if (!stat || !stat.isFile()) return false;
    if (stat.size < minRomBytes(ext)) return false;

    if (ext === '.md' && !(await looksLikeBinary(filePath))) return false;
    return true;
}

// Si la carpeta tiene un .cue, los .bin son pistas de ese disco y no juegos aparte.
async function hasCueSibling(filePath) {
    const dir = path.dirname(filePath);
    const names = await fsp.readdir(dir).catch(() => []);
    return names.some((name) => name.toLowerCase().endsWith('.cue'));
}

function isJunkDownloadName(name) {
    return DOC_NAME_PATTERN.test(name) || JUNK_DOWNLOAD_PATTERN.test(name);
}

function resolveSystemForExtension(ext, preferredSystem) {
    const profile = EXT_PROFILES[ext];
    if (!profile) return preferredSystem ? String(preferredSystem).toUpperCase() : null;

    const preferred = preferredSystem ? String(preferredSystem).toUpperCase() : null;
    if (preferred && (AMBIGUOUS_EXTS.has(ext) || profile.system === preferred)) {
        return preferred;
    }
    return profile.system;
}

function buildCoverUrl(system, title) {
    const dir = SYSTEM_COVER_DIR[system] || EXT_PROFILES[Object.keys(EXT_PROFILES).find((ext) => EXT_PROFILES[ext].system === system)]?.dir;
    if (!dir) return '';
    return `https://thumbnails.libretro.com/${encodeURIComponent(dir)}/Named_Boxarts/${encodeURIComponent(title + ' (USA)')}.png`;
}

function buildCueContent(entries) {
    const lines = [];
    entries.forEach((entry, index) => {
        lines.push(`FILE "${entry.name}" BINARY`);
        lines.push(`  TRACK ${String(index + 1).padStart(2, '0')} ${entry.mode}`);
        if (index > 0) lines.push('    INDEX 00 00:00:00');
        lines.push('    INDEX 01 00:00:00');
    });
    return lines.join('\n') + '\n';
}

// Crea un .cue cuando el usuario descarga una ISO de PS1 como .bin suelto.
async function ensureCueForBin(binPath) {
    const cuePath = path.join(path.dirname(binPath), path.parse(binPath).name + '.cue');
    if (fs.existsSync(cuePath)) return cuePath;

    const dir = path.dirname(binPath);
    const base = path.parse(binPath).name.toLowerCase();
    const siblings = await fsp.readdir(dir);
    const bins = siblings
        .filter((name) => name.toLowerCase().endsWith('.bin'))
        .filter((name) => {
            const siblingBase = path.parse(name).name.toLowerCase();
            return siblingBase === base || siblingBase.startsWith(`${base} (`) || siblingBase.startsWith(`${base}-`);
        })
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

    const names = bins.length > 0 ? bins : [path.basename(binPath)];
    const entries = [];
    for (const name of names) {
        const stat = await fsp.stat(path.join(dir, name)).catch(() => null);
        const mode = stat && stat.size % 2352 === 0 ? 'MODE2/2352' : 'MODE1/2048';
        entries.push({ name, mode });
    }

    await fsp.writeFile(cuePath, buildCueContent(entries), 'utf-8');
    return cuePath;
}

// Devuelve los archivos que forman parte del juego (no todo el contenido del ZIP).
async function collectGameFiles(allFiles, romFile) {
    const romDir = path.dirname(romFile);
    const romExt = path.extname(romFile).toLowerCase();
    const selected = new Set([romFile]);

    if (romExt === '.cue') {
        try {
            const cue = await fsp.readFile(romFile, 'utf-8');
            for (const match of cue.matchAll(/FILE\s+"([^"]+)"/gi)) {
                const candidate = path.join(romDir, match[1]);
                if (fs.existsSync(candidate)) selected.add(candidate);
            }
        } catch {
            // Si el .cue está dañado, al menos se copia el propio .cue.
        }
    } else if (romExt === '.bin') {
        const cuePath = path.join(romDir, path.parse(romFile).name + '.cue');
        if (fs.existsSync(cuePath)) selected.add(cuePath);
    } else {
        const base = path.parse(romFile).name.toLowerCase();
        for (const file of allFiles) {
            if (path.dirname(file) !== romDir) continue;
            const ext = path.extname(file).toLowerCase();
            if (!ROM_EXTS.has(ext) && !ROM_EXTRA_EXTS.has(ext)) continue;
            const fileBase = path.parse(file).name.toLowerCase();
            if (fileBase === base || fileBase.startsWith(`${base} (`) || fileBase.startsWith(`${base}-`)) {
                selected.add(file);
            }
        }
    }

    return [...selected];
}

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
};

// --- Seguridad y Validación ---
function resolveInside(baseDir, ...segments) {
    const resolvedBase = path.resolve(baseDir);
    const target = path.resolve(resolvedBase, ...segments);
    if (target !== resolvedBase && !target.startsWith(resolvedBase + path.sep)) {
        throw new Error('Ruta fuera del directorio permitido');
    }
    return target;
}

function sanitizeSlug(raw) {
    return raw
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'game';
}

function validateExternalUrl(rawUrl) {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Solo se permiten URLs http o https');
    }
    return parsed.toString();
}

const requestLogs = new Map();
function checkRateLimit(ip) {
    const now = Date.now();
    const timestamps = (requestLogs.get(ip) || []).filter((t) => now - t < 60_000);
    if (timestamps.length >= 300) return false;
    timestamps.push(now);
    requestLogs.set(ip, timestamps);
    return true;
}

async function walkFiles(dir) {
    if (!fs.existsSync(dir)) return [];
    const results = [];
    const list = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of list) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...(await walkFiles(full)));
        } else if (entry.isFile()) {
            results.push(full);
        }
    }
    return results;
}

// --- Catálogo y Sincronización con Disco ---
async function readCatalog() {
    try {
        const raw = await fsp.readFile(CATALOG_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

async function writeCatalog(games) {
    await fsp.mkdir(path.dirname(CATALOG_PATH), { recursive: true });
    await fsp.writeFile(CATALOG_PATH, JSON.stringify(games, null, 2), 'utf-8');
}

async function syncGamesFromDisk() {
    const catalog = await readCatalog();
    let modified = false;
    const validRelPaths = new Map();

    if (fs.existsSync(GAMES_DIR)) {
        const allGameFiles = await walkFiles(GAMES_DIR);
        const romFiles = [];

        for (const file of allGameFiles) {
            const ext = path.extname(file).toLowerCase();
            if (!ROM_EXTS.has(ext)) continue;
            if (ext === '.bin' && (await hasCueSibling(file))) continue;
            if (!(await isLikelyRomFile(file, ext))) continue;

            const rel = path.relative(GAMES_DIR, file).split(path.sep).join('/');
            validRelPaths.set(rel.toLowerCase(), rel);
            romFiles.push({ file, ext, rel });
        }

        const knownSystems = new Set(Object.values(EXT_PROFILES).map((profile) => profile.system));

        for (const { file: romFile, ext: romExt, rel } of romFiles) {
            const profile = EXT_PROFILES[romExt];
            const parts = rel.split('/');
            if (parts.length < 2) continue; // archivo suelto en la raíz de games/

            const firstFolder = parts[0].toUpperCase();
            const folderSystem = knownSystems.has(firstFolder) ? firstFolder : profile.system;
            const system = resolveSystemForExtension(romExt, folderSystem);
            const relExec = parts.slice(1).join('/');

            const parentFolder = path.dirname(romFile);
            const sysDirPath = path.join(GAMES_DIR, system.toLowerCase());
            let totalBytes = 0;
            if (parentFolder !== sysDirPath && parentFolder !== GAMES_DIR) {
                const siblingFiles = await walkFiles(parentFolder);
                for (const sf of siblingFiles) {
                    const st = await fsp.stat(sf).catch(() => null);
                    if (st) totalBytes += st.size;
                }
            } else {
                const st = await fsp.stat(romFile).catch(() => null);
                if (st) totalBytes = st.size;
            }

            const sizeMB = +(totalBytes / 1048576).toFixed(1);
            const existing = catalog.find(
                (g) => g.system.toUpperCase() === system && g.executableFile.toLowerCase() === relExec.toLowerCase()
            );

            if (existing) {
                if (existing.sizeMB !== sizeMB && sizeMB > 0) {
                    existing.sizeMB = sizeMB;
                    modified = true;
                }
            } else {
                const cleanTitle = path.parse(romFile).name.replace(/\s*[\(\[].*?[\)\]]/g, '').trim();
                const slug = sanitizeSlug(cleanTitle);
                const launch = system === 'PS1'
                    ? { emulator: 'retroarch', core: 'swanstation_libretro.dll' }
                    : { emulator: profile.emulator, core: profile.core };

                catalog.push({
                    id: `${system.toLowerCase()}-${slug}-${Date.now().toString(36)}`,
                    title: cleanTitle,
                    system,
                    year: new Date().getFullYear(),
                    sizeMB,
                    emulator: launch.emulator,
                    core: launch.core,
                    coverUrl: buildCoverUrl(system, cleanTitle),
                    executableFile: relExec
                });
                modified = true;
            }
        }
    }

    // Limpia entradas obsoletas (ROM borrada, README.md importado por error, etc.)
    // y corrige juegos guardados en la carpeta del sistema equivocado.
    const nextCatalog = [];
    const seenEntries = new Set();

    for (const game of catalog) {
        const ext = path.extname(game.executableFile || '').toLowerCase();
        if (!ROM_EXTS.has(ext)) {
            modified = true;
            continue;
        }

        const currentRel = `${game.system.toLowerCase()}/${game.executableFile}`.replace(/\\/g, '/');
        let actualRel = validRelPaths.get(currentRel.toLowerCase());

        if (!actualRel) {
            const suffix = `/${game.executableFile.toLowerCase()}`;
            for (const [key, value] of validRelPaths) {
                if (key.endsWith(suffix)) {
                    actualRel = value;
                    break;
                }
            }
        }

        if (!actualRel) {
            modified = true;
            continue;
        }

        let system = actualRel.split('/')[0].toUpperCase();
        const actualFolderSystem = system;
        const profile = EXT_PROFILES[ext];

        if (STRONG_SYSTEM_EXTS.has(ext)) {
            const expectedSystem = profile.system;
            if (actualFolderSystem !== expectedSystem) {
                const relDir = path.dirname(game.executableFile);
                try {
                    const src = resolveInside(GAMES_DIR, actualFolderSystem.toLowerCase(), relDir);
                    const dst = resolveInside(GAMES_DIR, expectedSystem.toLowerCase(), relDir);
                    if (relDir !== '.' && fs.existsSync(src) && !fs.existsSync(dst)) {
                        await fsp.mkdir(path.dirname(dst), { recursive: true });
                        await fsp.rename(src, dst);
                    }
                    if (relDir === '.' || fs.existsSync(dst)) {
                        system = expectedSystem;
                        modified = true;
                    }
                } catch {
                    // Si no se puede mover, se mantiene la ubicación actual.
                }
            }
        }

        const execRel = actualRel.split('/').slice(1).join('/');
        const key = `${system.toLowerCase()}|${execRel.toLowerCase()}`;
        if (seenEntries.has(key)) {
            modified = true;
            continue;
        }
        seenEntries.add(key);

        if (game.system !== system || game.executableFile !== execRel) {
            game.system = system;
            game.executableFile = execRel;
            game.coverUrl = buildCoverUrl(system, game.title) || game.coverUrl;
            modified = true;
        }

        const launch = system === 'PS1'
            ? { emulator: 'retroarch', core: 'swanstation_libretro.dll' }
            : { emulator: profile.emulator, core: profile.core };
        if (launch.emulator && (game.emulator !== launch.emulator || game.core !== launch.core)) {
            game.emulator = launch.emulator;
            game.core = launch.core;
            modified = true;
        }

        nextCatalog.push(game);
    }

    if (modified) {
        await writeCatalog(nextCatalog);
    }

    return nextCatalog.map((game) => {
        const romFullPath = path.join(GAMES_DIR, game.system.toLowerCase(), game.executableFile);
        return { ...game, installed: fs.existsSync(romFullPath) };
    });
}

async function saveGameToCatalog(gameEntry) {
    const catalog = await readCatalog();
    const idx = catalog.findIndex(
        (g) => g.system.toUpperCase() === gameEntry.system.toUpperCase() && g.executableFile === gameEntry.executableFile
    );
    if (idx >= 0) {
        catalog[idx] = { ...catalog[idx], ...gameEntry };
    } else {
        catalog.push(gameEntry);
    }
    await writeCatalog(catalog);
    return idx >= 0 ? catalog[idx] : gameEntry;
}

async function deleteGameFromCatalog(gameId) {
    const catalog = await readCatalog();
    const game = catalog.find((g) => g.id === gameId);
    if (!game) return false;

    const relDir = path.dirname(game.executableFile);
    if (relDir !== '.') {
        const gameFolder = resolveInside(GAMES_DIR, game.system.toLowerCase(), relDir);
        const sysRoot = resolveInside(GAMES_DIR, game.system.toLowerCase());
        if (gameFolder !== sysRoot) {
            await fsp.rm(gameFolder, { recursive: true, force: true }).catch(() => { });
        }
    } else {
        const singleFile = resolveInside(GAMES_DIR, game.system.toLowerCase(), game.executableFile);
        await fsp.rm(singleFile, { force: true }).catch(() => { });
    }

    await writeCatalog(catalog.filter((g) => g.id !== gameId));
    return true;
}

// --- Eventos SSE ---
const sseClients = new Set();
function publishEvent(payload) {
    const line = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of sseClients) {
        try {
            res.write(line);
        } catch {
            sseClients.delete(res);
        }
    }
}

// --- Puente Ratón -> Stick Derecho PS1 (Cursor 100% invisible sin parpadeo) ---
let mouseBridgeProcess = null;

function restoreWindowsCursorNow() {
    if (process.platform !== 'win32') return;
    spawn(
        'powershell.exe',
        [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            'Add-Type -TypeDefinition \'using System.Runtime.InteropServices; public class C { [DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint a, uint b, System.IntPtr c, uint d); }\'; [C]::SystemParametersInfo(0x0057, 0, [System.IntPtr]::Zero, 0)'
        ],
        { shell: false, windowsHide: true }
    );
}

function stopMouseToRightStickBridge() {
    if (mouseBridgeProcess) {
        try {
            mouseBridgeProcess.kill();
        } catch { }
        mouseBridgeProcess = null;
    }
    restoreWindowsCursorNow();
}

function startMouseToRightStickBridge() {
    if (process.platform !== 'win32') return;
    stopMouseToRightStickBridge();

    const psScript = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public class MouseRightStickBridge {
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT lpPoint);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vKey);
    [DllImport("user32.dll")] static extern uint MapVirtualKey(uint uCode, uint uMapType);
    [DllImport("user32.dll")] static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    [DllImport("user32.dll")] static extern IntPtr CreateCursor(IntPtr hInst, int xHotSpot, int yHotSpot, int nWidth, int nHeight, byte[] pvANDPlane, byte[] pvXORPlane);
    [DllImport("user32.dll")] static extern bool SetSystemCursor(IntPtr hcur, uint id);
    [DllImport("user32.dll")] static extern bool SystemParametersInfo(uint uiAction, uint uiParam, IntPtr pvParam, uint fWinIni);

    const uint KEYEVENTF_KEYUP = 0x0002;
    const uint SPI_SETCURSORS = 0x0057;
    const uint OCR_NORMAL = 32512;

    const byte VK_NUMPAD8 = 0x68; // Stick Derecho Arriba
    const byte VK_NUMPAD2 = 0x62; // Stick Derecho Abajo
    const byte VK_NUMPAD4 = 0x64; // Cámara / Stick Derecho Izquierda
    const byte VK_NUMPAD6 = 0x66; // Cámara / Stick Derecho Derecha

    static bool upHeld = false, downHeld = false, leftHeld = false, rightHeld = false;
    static bool cursorHidden = false;

    static void SetCursorVisible(bool visible) {
        if (!visible && !cursorHidden) {
            byte[] andMask = new byte[128];
            byte[] xorMask = new byte[128];
            for (int i = 0; i < 128; i++) { andMask[i] = 0xFF; xorMask[i] = 0x00; }
            IntPtr blank = CreateCursor(IntPtr.Zero, 0, 0, 32, 32, andMask, xorMask);
            if (blank != IntPtr.Zero) {
                SetSystemCursor(blank, OCR_NORMAL);
                cursorHidden = true;
            }
        } else if (visible && cursorHidden) {
            SystemParametersInfo(SPI_SETCURSORS, 0, IntPtr.Zero, 0);
            cursorHidden = false;
        }
    }

    static void SetKey(byte vk, ref bool held, bool press) {
        byte scan = (byte)MapVirtualKey(vk, 0);
        if (press && !held) {
            keybd_event(vk, scan, 0, UIntPtr.Zero);
            held = true;
        } else if (!press && held) {
            keybd_event(vk, scan, KEYEVENTF_KEYUP, UIntPtr.Zero);
            held = false;
        }
    }

    static void ReleaseAll() {
        SetKey(VK_NUMPAD8, ref upHeld, false);
        SetKey(VK_NUMPAD2, ref downHeld, false);
        SetKey(VK_NUMPAD4, ref leftHeld, false);
        SetKey(VK_NUMPAD6, ref rightHeld, false);
    }

    public static void Run() {
        AppDomain.CurrentDomain.ProcessExit += (s, e) => SetCursorVisible(true);
        bool toggleOff = false;
        bool f11WasDown = false;
        int deadzone = 5;
        int holdX = 0, holdY = 0;
        int dirX = 0, dirY = 0;

        while (true) {
            bool f11Down = (GetAsyncKeyState(0x7A) & 0x8000) != 0; // F11 libera/oculta el ratón
            if (f11Down && !f11WasDown) toggleOff = !toggleOff;
            f11WasDown = f11Down;

            IntPtr fg = GetForegroundWindow();
            StringBuilder sb = new StringBuilder(256);
            GetWindowText(fg, sb, 256);
            string title = sb.ToString();

            if (!toggleOff && title.IndexOf("RetroArch", StringComparison.OrdinalIgnoreCase) >= 0) {
                RECT rect;
                if (GetWindowRect(fg, out rect)) {
                    int cx = (rect.Left + rect.Right) / 2;
                    int cy = (rect.Top + rect.Bottom) / 2;
                    POINT p;
                    if (GetCursorPos(out p)) {
                        // Deja libres los bordes (45px) para mover o redimensionar la ventana
                        bool insideClient = p.X > rect.Left + 45 && p.X < rect.Right - 45 &&
                                            p.Y > rect.Top + 55 && p.Y < rect.Bottom - 45;
                        if (insideClient) {
                            SetCursorVisible(false);
                            int dx = p.X - cx;
                            int dy = p.Y - cy;

                            if (Math.Abs(dx) > deadzone) {
                                dirX = dx > 0 ? 1 : -1;
                                holdX = 3;
                            } else if (holdX > 0) {
                                holdX--;
                            } else {
                                dirX = 0;
                            }

                            if (Math.Abs(dy) > deadzone) {
                                dirY = dy > 0 ? 1 : -1;
                                holdY = 3;
                            } else if (holdY > 0) {
                                holdY--;
                            } else {
                                dirY = 0;
                            }

                            SetKey(VK_NUMPAD4, ref leftHeld, dirX > 0);
                            SetKey(VK_NUMPAD6, ref rightHeld, dirX < 0);
                            SetKey(VK_NUMPAD8, ref upHeld, dirY < 0);
                            SetKey(VK_NUMPAD2, ref downHeld, dirY > 0);

                            if (dx != 0 || dy != 0) {
                                SetCursorPos(cx, cy);
                            }
                        } else {
                            SetCursorVisible(true);
                            holdX = 0; holdY = 0; dirX = 0; dirY = 0;
                            ReleaseAll();
                        }
                    }
                }
            } else {
                SetCursorVisible(true);
                holdX = 0; holdY = 0; dirX = 0; dirY = 0;
                ReleaseAll();
            }
            Thread.Sleep(25);
        }
    }
}
"@
[MouseRightStickBridge]::Run()
`;

    mouseBridgeProcess = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
        { shell: false, windowsHide: true }
    );

    mouseBridgeProcess.on('error', () => {
        mouseBridgeProcess = null;
    });
}

// --- Autoconfiguración de Ventana y Controles ---
async function ensureRetroArchAutoControls(retroarchDir) {
    const cfgPath = path.join(retroarchDir, 'retroarch.cfg');
    const coreOptDir = path.join(retroarchDir, 'config', 'SwanStation');
    const coreOptPath = path.join(coreOptDir, 'SwanStation.opt');

    const autoSettings = {
        // Ventana redimensionable a mayor tamaño (escala 4x)
        video_fullscreen: '"false"',
        video_windowed_fullscreen: '"false"',
        video_window_show_decorations: '"true"',
        video_window_save_positions: '"true"',
        video_window_custom_size_enable: '"false"',
        video_scale: '"4"',
        // Calidad de imagen HD: suavizado y escalado sin pixelado forzado
        video_smooth: '"true"',
        video_threaded: '"true"',
        video_vsync: '"true"',
        video_scale_integer: '"false"',
        video_shader_enable: '"false"',
        video_crop_overscan: '"true"',
        video_aspect_ratio: '"4:3"',
        // Cursor oculto dentro de RetroArch
        input_mouse_hide_enable: '"true"',
        input_auto_mouse_grab: '"false"',
        // Driver SDL2 y bloqueo de hotkeys accidentales (exige F12 para atajos)
        input_driver: '"sdl2"',
        input_joypad_driver: '"xinput"',
        input_autodetect_enable: '"true"',
        joypad_autoconfig_dir: '":\\autoconfig"',
        auto_remaps_enable: '"true"',
        input_enable_hotkey: '"f12"',
        input_pause_toggle: '"p"',
        input_frame_advance: '"nul"',
        // Flechas del teclado = Stick Izquierdo + Cruceta (movimiento del personaje)
        input_player1_l_y_minus: '"up"',
        input_player1_l_y_plus: '"down"',
        input_player1_l_x_minus: '"left"',
        input_player1_l_x_plus: '"right"',
        input_player1_up: '"up"',
        input_player1_down: '"down"',
        input_player1_left: '"left"',
        input_player1_right: '"right"',
        // Movimiento del ratón (Keypad 8/2/4/6) -> Stick Derecho (Arriba/Abajo/Izquierda/Derecha) + L2/R2
        input_player1_r_y_minus: '"keypad8"',
        input_player1_r_y_plus: '"keypad2"',
        input_player1_r_x_minus: '"keypad4"',
        input_player1_r_x_plus: '"keypad6"',
        input_player1_l2: '"keypad4"',
        input_player1_r2: '"keypad6"',
        // L1 y R1 libres en Q y E (para agacharse/planear y fijar objetivo sin que los active el ratón)
        input_player1_l: '"q"',
        input_player1_r: '"e"',
        // Clics del ratón = Botones principales
        input_player1_b_mbtn: '"1"',      // Clic Izquierdo -> Cruz / Saltar / Confirmar
        input_player1_y_mbtn: '"2"',      // Clic Derecho -> Cuadrado / Atacar
        input_player1_x_mbtn: '"3"',      // Clic Central -> Triángulo (Vista libre)
        input_player1_a_mbtn: '"4"',      // Botón lateral -> Círculo
        // Menú y salir
        input_player1_start: '"enter"',
        input_player1_select: '"rshift"',
        input_exit_emulator: '"escape"',
        input_enable_hotkey_btn: '"6"',
        input_exit_emulator_btn: '"7"'
    };

    let content = '';
    if (fs.existsSync(cfgPath)) {
        content = await fsp.readFile(cfgPath, 'utf-8');
    }

    for (const [key, value] of Object.entries(autoSettings)) {
        const regex = new RegExp(`^${key}\\s*=.*$`, 'm');
        if (regex.test(content)) {
            content = content.replace(regex, `${key} = ${value}`);
        } else {
            content += `\n${key} = ${value}`;
        }
    }

    await fsp.writeFile(cfgPath, content.trim() + '\n', 'utf-8');

    // SwanStation (PS1): mando DualShock + renderizado en HD (4x) con PGXP.
    // Si tu PC puede más, sube swanstation_GPU_ResolutionScale a 5, 6 u 8.
    await fsp.mkdir(coreOptDir, { recursive: true });
    let optContent = fs.existsSync(coreOptPath) ? await fsp.readFile(coreOptPath, 'utf-8') : '';
    const ps1Opts = {
        duckstation_Controller1_Type: '"AnalogController"',
        duckstation_Controller1_ForceAnalogOnReset: '"true"',
        swanstation_GPU_ResolutionScale: '"4"',
        swanstation_GPU_TextureFilter: '"Bilinear"',
        swanstation_GPU_PGXPEnable: '"true"',
        swanstation_GPU_PGXPPreserveProjFP: '"true"',
        swanstation_GPU_PGXPTextureCorrection: '"true"',
        swanstation_GPU_PGXPVertexCache: '"true"',
        swanstation_GPU_PGXPDepthBuffer: '"true"',
        swanstation_GPU_TrueColor: '"true"',
        swanstation_GPU_ScaledDithering: '"true"',
        swanstation_GPU_DisableInterlacing: '"true"',
        swanstation_GPU_Renderer: '"Auto"',
        swanstation_Display_AspectRatio: '"4:3"',
        swanstation_Display_CropMode: '"Overscan"',
        swanstation_CPU_Overclock: '"100"'
    };

    for (const [key, value] of Object.entries(ps1Opts)) {
        const regex = new RegExp(`^${key}\\s*=.*$`, 'm');
        if (regex.test(optContent)) {
            optContent = optContent.replace(regex, `${key} = ${value}`);
        } else {
            optContent += `\n${key} = ${value}`;
        }
    }
    await fsp.writeFile(coreOptPath, optContent.trim() + '\n', 'utf-8');
}

// --- Configuración Inicial y Estado de Emuladores ---
const PS1_BIOS_NAMES = ['scph5500.bin', 'scph5501.bin', 'scph5502.bin', 'scph7001.bin', 'scph7002.bin', 'scph7003.bin', 'scph1001.bin', 'scph101.bin', 'ps1_rom.bin'];
const PS2_BIOS_PATTERN = /^scph[\w.-]*\.bin$/i;
const STATUS_CORES = {
    PS1: 'swanstation_libretro.dll',
    SNES: 'snes9x_libretro.dll',
    NES: 'nestopia_libretro.dll',
    N64: 'mupen64plus_next_libretro.dll',
    GB: 'gambatte_libretro.dll',
    GBC: 'gambatte_libretro.dll',
    GBA: 'mgba_libretro.dll',
    NDS: 'melonds_libretro.dll',
    GENESIS: 'genesis_plus_gx_libretro.dll'
};

async function listFilesLower(dir) {
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name.toLowerCase());
}

async function findPs1Bios() {
    const roots = [
        path.join(EMULATORS_DIR, 'retroarch', 'system'),
        path.join(EMULATORS_DIR, 'retroarch'),
        PCSX2_BIOS_DIR
    ];
    for (const root of roots) {
        const files = await listFilesLower(root);
        const found = files.find((name) => PS1_BIOS_NAMES.includes(name));
        if (found) return { found: true, name: found, dir: root };
    }
    return { found: false, name: null, dir: roots[0] };
}

async function findPs2Bios() {
    const files = await listFilesLower(PCSX2_BIOS_DIR);
    const matches = files.filter((name) => PS2_BIOS_PATTERN.test(name));
    return { found: matches.length > 0, files: matches, dir: PCSX2_BIOS_DIR };
}

// PCSX2 guarda su configuración en Documentos. La primera vez copiamos la
// plantilla ya optimizada (3x, FXAA, mando Xbox) sin pisar la del usuario.
async function ensurePcsx2FirstRunConfig() {
    const folders = ['bios', 'cache', 'cheats', 'covers', 'gamesettings', 'inis', 'inputprofiles', 'logs', 'memcards', 'patches', 'resources', 'snaps', 'sstates', 'textures', 'videos'];
    for (const folder of folders) {
        await fsp.mkdir(path.join(PCSX2_DATA_DIR, folder), { recursive: true }).catch(() => {});
    }

    if (fs.existsSync(PCSX2_INI_PATH)) return false;

    const templatePath = path.join(CONFIG_TEMPLATES_DIR, 'PCSX2.ini');
    if (!fs.existsSync(templatePath)) return false;

    let ini = await fsp.readFile(templatePath, 'utf-8');
    // La plantilla se distribuye sin rutas absolutas ni un BIOS concreto.
    ini = ini.replace(/^Bios\s*=.*$/m, 'Bios = bios');
    ini = ini.replace(/^BIOS\s*=.*$/m, 'BIOS =');
    await fsp.writeFile(PCSX2_INI_PATH, ini.trim() + '\n', 'utf-8');
    return true;
}

// Dolphin solo usa su carpeta "User" junto al ejecutable si existe portable.txt.
async function ensureDolphinPortableMode() {
    const dolphinDir = path.join(EMULATORS_DIR, 'dolphin');
    if (!fs.existsSync(path.join(dolphinDir, 'Dolphin.exe'))) return false;
    const flagPath = path.join(dolphinDir, 'portable.txt');
    if (!fs.existsSync(flagPath)) {
        await fsp.writeFile(flagPath, 'MegaRetro Hub: modo portable\r\n', 'utf-8');
        return true;
    }
    return false;
}

async function buildEmulatorStatus() {
    const retroarchDir = path.join(EMULATORS_DIR, 'retroarch');
    const retroarchBin = path.join(retroarchDir, 'retroarch.exe');
    const coreFiles = await listFilesLower(path.join(retroarchDir, 'cores'));
    const missingCores = Object.values(STATUS_CORES).filter((core) => !coreFiles.includes(core));
    const ps1Bios = await findPs1Bios();
    const ps2Bios = await findPs2Bios();
    const pcsx2Bin = findPcsx2Executable();
    const dolphinBin = [path.join(EMULATORS_DIR, 'dolphin', 'Dolphin.exe')].find((candidate) => fs.existsSync(candidate)) || null;

    const systems = [
        {
            id: 'PS1',
            label: 'PlayStation 1',
            emulator: 'RetroArch (SwanStation)',
            ready: fs.existsSync(retroarchBin) && coreFiles.includes(STATUS_CORES.PS1),
            note: ps1Bios.found ? 'BIOS detectada' : 'Funciona sin BIOS, pero se recomienda añadir una BIOS de tu consola'
        },
        {
            id: 'PS2',
            label: 'PlayStation 2',
            emulator: 'PCSX2',
            ready: Boolean(pcsx2Bin) && ps2Bios.found,
            note: ps2Bios.found ? 'BIOS detectada' : 'Necesita una BIOS de PS2 (scphXXXXX.bin) en Documentos\\PCSX2\\bios'
        },
        {
            id: 'GC',
            label: 'GameCube',
            emulator: 'Dolphin',
            ready: Boolean(dolphinBin),
            note: dolphinBin ? 'Listo para jugar' : 'Dolphin no encontrado'
        },
        {
            id: 'RETRO',
            label: 'SNES / NES / N64 / GB / GBC / GBA / NDS / Mega Drive',
            emulator: 'RetroArch',
            ready: fs.existsSync(retroarchBin) && missingCores.length === 0,
            note: missingCores.length === 0 ? 'Todos los núcleos instalados' : `Faltan núcleos: ${missingCores.join(', ')}`
        }
    ];

    return {
        packaged: PACKAGED,
        dataDir: DATA_DIR,
        gamesDir: GAMES_DIR,
        downloadsDir: DOWNLOADS_DIR,
        emulators: {
            retroarch: { installed: fs.existsSync(retroarchBin), dir: retroarchDir, missingCores },
            pcsx2: { installed: Boolean(pcsx2Bin), dir: pcsx2Bin ? path.dirname(pcsx2Bin) : path.join(EMULATORS_DIR, 'pcsx2'), configPrepared: fs.existsSync(PCSX2_INI_PATH) },
            dolphin: { installed: Boolean(dolphinBin), dir: path.join(EMULATORS_DIR, 'dolphin'), portable: fs.existsSync(path.join(EMULATORS_DIR, 'dolphin', 'portable.txt')) }
        },
        bios: {
            ps1: ps1Bios,
            ps2: ps2Bios
        },
        systems
    };
}

const OPENABLE_FOLDERS = {
    data: () => DATA_DIR,
    games: () => GAMES_DIR,
    downloads: () => DOWNLOADS_DIR,
    emulators: () => EMULATORS_DIR,
    'ps2-bios': () => PCSX2_BIOS_DIR
};

function openFolder(target) {
    const resolveDir = OPENABLE_FOLDERS[target];
    if (!resolveDir) throw new Error('Carpeta no válida');
    const dir = resolveDir();
    fs.mkdirSync(dir, { recursive: true });
    if (process.platform === 'win32') {
        spawn('explorer.exe', [dir], { shell: false, detached: true, windowsHide: true }).unref();
    } else if (process.platform === 'darwin') {
        spawn('open', [dir], { shell: false, detached: true }).unref();
    } else {
        spawn('xdg-open', [dir], { shell: false, detached: true }).unref();
    }
    return dir;
}

// --- Ejecución de Emulador ---
let activeEmulatorProcess = null;
let activeGameInfo = null;

function findPcsx2Executable() {
    const candidates = [
        path.join(EMULATORS_DIR, 'pcsx2', 'pcsx2-qt.exe'),
        path.join(EMULATORS_DIR, 'pcsx2', 'pcsx2.exe'),
        'C:\\Program Files\\PCSX2\\pcsx2-qt.exe',
        'C:\\Program Files (x86)\\PCSX2\\pcsx2-qt.exe'
    ];
    if (process.env.LOCALAPPDATA) {
        candidates.push(
            path.join(process.env.LOCALAPPDATA, 'Programs', 'PCSX2', 'pcsx2-qt.exe')
        );
    }
    return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function launchGameById(gameId) {
    if (activeEmulatorProcess) {
        throw new Error('Ya hay un emulador abierto.');
    }

    const catalog = await readCatalog();
    const game = catalog.find((g) => g.id === gameId);
    if (!game) throw new Error('Juego no encontrado en el catálogo.');

    const romPath = resolveInside(GAMES_DIR, game.system.toLowerCase(), game.executableFile);
    if (!fs.existsSync(romPath)) {
        throw new Error(`No se encontró el archivo del juego: ${game.executableFile}`);
    }

    let cwd, bin, args;
    if (game.emulator === 'retroarch') {
        cwd = resolveInside(EMULATORS_DIR, 'retroarch');
        bin = resolveInside(cwd, process.platform === 'win32' ? 'retroarch.exe' : 'retroarch');
        const corePath = resolveInside(cwd, 'cores', game.core);

        if (!fs.existsSync(bin)) {
            throw new Error('No se encontró retroarch.exe dentro de emulators/retroarch/');
        }
        if (!fs.existsSync(corePath)) {
            throw new Error(`Falta el núcleo ${game.core} en emulators/retroarch/cores/`);
        }

        await ensureRetroArchAutoControls(cwd);
        if (game.system.toUpperCase() === 'PS1') {
            startMouseToRightStickBridge();
        }
        args = ['-L', corePath, romPath];
    } else if (game.emulator === 'pcsx2') {
        bin = findPcsx2Executable();
        if (!bin) {
            throw new Error(
                'No se encontró PCSX2. Instálalo en emulators/pcsx2/ (pcsx2-qt.exe) o en Program Files/PCSX2.'
            );
        }
        cwd = path.dirname(bin);
        args = ['-batch', romPath];
    } else if (game.emulator === 'dolphin') {
        const dolphinCandidates = [
            path.join(EMULATORS_DIR, 'dolphin', 'Dolphin.exe'),
            'C:\\Program Files\\Dolphin\\Dolphin.exe',
            'C:\\Program Files (x86)\\Dolphin\\Dolphin.exe'
        ];
        bin = dolphinCandidates.find((candidate) => fs.existsSync(candidate)) || null;
        if (!bin) {
            throw new Error(
                'No se encontró Dolphin. Instálalo en emulators/dolphin/ (Dolphin.exe).'
            );
        }
        cwd = path.dirname(bin);
        args = ['-e', romPath];
    } else {
        throw new Error(`Emulador no soportado: ${game.emulator}`);
    }

    activeGameInfo = { gameId: game.id, title: game.title };
    publishEvent({ type: 'GAME_STARTED', gameId: game.id, title: game.title });

    activeEmulatorProcess = spawn(bin, args, { cwd, shell: false, detached: false });

    activeEmulatorProcess.on('close', () => {
        activeEmulatorProcess = null;
        activeGameInfo = null;
        stopMouseToRightStickBridge();
        setTimeout(() => {
            publishEvent({ type: 'GAME_CLOSED', gameId: game.id });
        }, 300);
    });

    activeEmulatorProcess.on('error', (err) => {
        activeEmulatorProcess = null;
        activeGameInfo = null;
        stopMouseToRightStickBridge();
        publishEvent({ type: 'GAME_ERROR', message: `Error al abrir emulador: ${err.message}` });
    });

    return { launched: true, title: game.title };
}

function stopActiveGame() {
    const proc = activeEmulatorProcess;
    if (!proc || proc.pid == null) {
        activeGameInfo = null;
        publishEvent({ type: 'GAME_CLOSED' });
        return false;
    }

    try {
        if (process.platform === 'win32') {
            // taskkill /T cierra también los procesos hijos del emulador.
            spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { shell: false });
        } else {
            proc.kill('SIGTERM');
        }
    } catch {
        // El evento 'close' del proceso limpiará el estado igualmente.
    }

    return true;
}

// --- Extracción e Importación Automática (ZIP / 7z / ROMs) ---
const activeImports = new Set();
let expectedSystem = null;
let radarActive = false;
let shutdownTimer = null;

function find7ZipBinary() {
    const candidates = [
        process.env.ProgramFiles && path.join(process.env.ProgramFiles, '7-Zip', '7z.exe'),
        process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], '7-Zip', '7z.exe'),
        'C:\\Program Files\\7-Zip\\7z.exe',
        'C:\\Program Files (x86)\\7-Zip\\7z.exe'
    ].filter(Boolean);
    return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function extractWith7Zip(archivePath, destDir) {
    const bin = find7ZipBinary();
    if (!bin) throw new Error('7-Zip no está instalado');

    await new Promise((resolve, reject) => {
        const proc = spawn(bin, ['x', '-y', `-o${destDir}`, archivePath], { shell: false, windowsHide: true });
        let errOut = '';
        proc.stderr?.on('data', (d) => (errOut += d.toString()));
        proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(errOut || `7z exit ${code}`))));
        proc.on('error', reject);
    });
}

async function extractArchiveSafely(archivePath, destDir) {
    const is7z = archivePath.toLowerCase().endsWith('.7z');
    let tarError = null;

    try {
        await new Promise((resolve, reject) => {
            const proc = spawn('tar', ['-xf', archivePath, '-C', destDir], { shell: false });
            let errOut = '';
            proc.stderr?.on('data', (d) => (errOut += d.toString()));
            proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(errOut || `tar exit ${code}`))));
            proc.on('error', reject);
        });
        const extracted = await walkFiles(destDir);
        if (extracted.length > 0) return;
    } catch (err) {
        tarError = err;
    }

    if (is7z) {
        try {
            await extractWith7Zip(archivePath, destDir);
            const extracted = await walkFiles(destDir);
            if (extracted.length > 0) return;
        } catch (sevenZipError) {
            throw new Error(
                `No se pudo extraer el archivo .7z (${tarError?.message || 'tar no lo soporta'} / ${sevenZipError.message})`
            );
        }
    }

    await new Promise((resolve, reject) => {
        const psCmd = `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`;
        const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCmd], {
            shell: false,
            windowsHide: true
        });
        let errOut = '';
        proc.stderr?.on('data', (d) => (errOut += d.toString()));
        proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(errOut || 'Error al descomprimir el ZIP'))));
        proc.on('error', reject);
    });
}

async function importDownloadedFile(sourcePath, silentIfNoRom = false) {
    if (activeImports.has(sourcePath)) return;
    activeImports.add(sourcePath);

    const stagingDir = path.join(GAMES_DIR, `.staging_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
    let filename = path.basename(sourcePath);

    try {
        let stableCount = 0;
        let prevSize = -1;

        for (let i = 0; i < 600; i++) {
            await new Promise((r) => setTimeout(r, 1000));
            if (!fs.existsSync(sourcePath)) return;

            try {
                const st = await fsp.stat(sourcePath);
                const handle = await fsp.open(sourcePath, 'r+');
                await handle.close();

                if (st.size > 0 && st.size === prevSize) {
                    stableCount++;
                    if (stableCount >= 2) break;
                } else {
                    stableCount = 0;
                }
                prevSize = st.size;
            } catch {
                stableCount = 0;
            }
        }

        filename = path.basename(sourcePath);
        const sourceDir = path.dirname(sourcePath);
        const extLower = path.extname(filename).toLowerCase();
        const isArchive = ARCHIVE_EXTS.includes(extLower);

        if (!silentIfNoRom) {
            publishEvent({ type: 'IMPORT_STARTED', message: `Extrayendo e instalando "${filename}"...` });
        }
        await fsp.mkdir(stagingDir, { recursive: true });

        if (isArchive) {
            await extractArchiveSafely(sourcePath, stagingDir);
        } else {
            await fsp.copyFile(sourcePath, path.join(stagingDir, filename));

            if (extLower === '.cue') {
                const baseName = path.parse(filename).name.toLowerCase();
                const siblings = await fsp.readdir(sourceDir);
                for (const sib of siblings) {
                    if (
                        sib.toLowerCase() !== filename.toLowerCase() &&
                        sib.toLowerCase().startsWith(baseName) &&
                        sib.toLowerCase().endsWith('.bin')
                    ) {
                        await fsp.copyFile(path.join(sourceDir, sib), path.join(stagingDir, sib));
                    }
                }
            }
        }

        const allFiles = await walkFiles(stagingDir);

        // Elige la ROM principal ignorando README.md, manuales, etc.
        const candidates = [];
        for (const file of allFiles) {
            const ext = path.extname(file).toLowerCase();
            if (!ROM_EXTS.has(ext)) continue;
            if (!(await isLikelyRomFile(file, ext))) continue;
            candidates.push({ file, ext });
        }

        const priority = ['.cue', '.m3u', '.chd', '.iso', '.bin', '.img'];
        candidates.sort((a, b) => {
            const pa = priority.indexOf(a.ext);
            const pb = priority.indexOf(b.ext);
            return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
        });

        let romFile = candidates[0]?.file || null;
        if (!romFile) {
            throw new Error('El archivo no contiene una ROM de juego compatible.');
        }

        let romExt = path.extname(romFile).toLowerCase();

        // Descargas de PS1 que vienen como .bin suelto (sin .cue): se genera el .cue.
        if (romExt === '.bin') {
            romFile = await ensureCueForBin(romFile);
            romExt = '.cue';
        }

        const profile = EXT_PROFILES[romExt];
        const system = resolveSystemForExtension(
            romExt,
            expectedSystem || EXT_PROFILES[path.extname(candidates[0].file).toLowerCase()]?.system || null
        );
        const cleanTitle = path.parse(romFile).name.replace(/\s*[\(\[].*?[\)\]]/g, '').trim();
        const slug = sanitizeSlug(cleanTitle);

        const gameFiles = await collectGameFiles(allFiles, romFile);
        if (gameFiles.length === 0) {
            throw new Error('No se encontraron los archivos del juego.');
        }

        const targetDir = resolveInside(GAMES_DIR, system.toLowerCase(), slug);
        await fsp.mkdir(targetDir, { recursive: true });

        let totalBytes = 0;
        for (const srcFile of gameFiles) {
            const stat = await fsp.stat(srcFile).catch(() => null);
            if (!stat) continue;
            totalBytes += stat.size;
            const destFile = resolveInside(targetDir, path.basename(srcFile));
            await fsp.rm(destFile, { force: true }).catch(() => { });
            await fsp.rename(srcFile, destFile);
        }

        if (romExt === '.cue' && totalBytes < 1_048_576) {
            throw new Error('El archivo .cue no venía acompañado de su archivo .bin completo.');
        }

        const launch = system === 'PS1'
            ? { emulator: 'retroarch', core: 'swanstation_libretro.dll' }
            : { emulator: profile.emulator, core: profile.core };

        const savedGame = await saveGameToCatalog({
            id: `${system.toLowerCase()}-${slug}-${Date.now().toString(36)}`,
            title: cleanTitle,
            system,
            year: new Date().getFullYear(),
            sizeMB: +(totalBytes / 1048576).toFixed(1),
            emulator: launch.emulator,
            core: launch.core,
            coverUrl: buildCoverUrl(system, cleanTitle),
            executableFile: path.posix.join(slug, path.basename(romFile))
        });

        if (isArchive) {
            await fsp.unlink(sourcePath).catch(() => { });
        }

        publishEvent({ type: 'GAME_IMPORTED', game: { ...savedGame, installed: true } });
    } catch (err) {
        const noRomError = err.message.includes('no contiene una ROM') || err.message.includes('no contiene una ROM de juego');
        if (!silentIfNoRom || !noRomError) {
            publishEvent({
                type: 'ERROR_TOAST',
                message: `No se pudo importar "${filename}": ${err.message}`
            });
        }
    } finally {
        activeImports.delete(sourcePath);
        await fsp.rm(stagingDir, { recursive: true, force: true }).catch(() => { });
    }
}

function startDownloadsRadar() {
    if (!fs.existsSync(DOWNLOADS_DIR)) return;
    fs.watch(DOWNLOADS_DIR, (eventType, filename) => {
        if (!filename) return;
        const lower = filename.toLowerCase();
        if (lower.endsWith('.crdownload') || lower.endsWith('.part') || lower.endsWith('.tmp')) return;

        const ext = path.extname(lower);
        if (!ARCHIVE_EXTS.includes(ext) && !ROM_EXTS.has(ext)) return;
        if (isJunkDownloadName(filename)) return;

        const fullPath = path.join(DOWNLOADS_DIR, filename);
        if (fs.existsSync(fullPath)) {
            importDownloadedFile(fullPath, false);
        }
    });
}

// --- Abrir Ventana de Escritorio / Portal Externo ---
function openDesktopWindow(url) {
    if (process.platform === 'win32') {
        const edgePaths = [
            'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
            'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
        ];
        const chromePaths = [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
        ];

        const browserBin = [...edgePaths, ...chromePaths].find((p) => fs.existsSync(p));
        if (browserBin) {
            spawn(browserBin, [`--app=${url}`, '--start-fullscreen'], {
                detached: true,
                stdio: 'ignore',
                shell: false
            }).unref();
            return;
        }

        spawn('cmd.exe', ['/c', 'start', '', url], {
            detached: true,
            stdio: 'ignore',
            shell: false,
            windowsHide: true
        }).unref();
    }
}

function openExternalBrowser(url) {
    const safeUrl = validateExternalUrl(url);
    if (process.platform === 'win32') {
        spawn('cmd.exe', ['/c', 'start', '', safeUrl], {
            detached: true,
            stdio: 'ignore',
            shell: false,
            windowsHide: true
        }).unref();
    }
}

// --- Servidor HTTP ---
function applySecurityHeaders(req, res) {
    const origin = req.headers.origin;
    const allowed = [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`];
    res.setHeader(
        'Access-Control-Allow-Origin',
        origin && allowed.includes(origin) ? origin : `http://localhost:${PORT}`
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(req, res, status, data) {
    applySecurityHeaders(req, res);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let raw = '';
        req.on('data', (chunk) => {
            raw += chunk;
            if (raw.length > 1_048_576) {
                reject(new Error('Payload demasiado grande'));
                req.destroy();
            }
        });
        req.on('end', () => {
            try {
                resolve(raw ? JSON.parse(raw) : {});
            } catch {
                reject(new Error('JSON inválido'));
            }
        });
        req.on('error', reject);
    });
}

async function serveStatic(req, res, pathname) {
    const distBase = fs.existsSync(CLIENT_DIST_DIR) ? CLIENT_DIST_DIR : CLIENT_DIST_FALLBACK;
    const relPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');

    let filePath;
    try {
        filePath = resolveInside(distBase, relPath);
    } catch {
        return sendJson(req, res, 403, { error: 'Acceso denegado' });
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(distBase, 'index.html');
    }

    if (!fs.existsSync(filePath)) {
        applySecurityHeaders(req, res);
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Frontend no compilado. Ejecuta npm run build en /client');
        return;
    }

    const ext = path.extname(filePath).toLowerCase();
    applySecurityHeaders(req, res);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
    const clientIp = req.socket.remoteAddress || '127.0.0.1';
    if (!checkRateLimit(clientIp)) {
        return sendJson(req, res, 429, { error: 'Demasiadas peticiones' });
    }

    if (req.method === 'OPTIONS') {
        applySecurityHeaders(req, res);
        res.writeHead(204);
        res.end();
        return;
    }

    const urlObj = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = urlObj.pathname;

    try {
        if (req.method === 'GET' && pathname === '/api/events') {
            if (shutdownTimer) {
                clearTimeout(shutdownTimer);
                shutdownTimer = null;
            }
            applySecurityHeaders(req, res);
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive'
            });
            res.write(`data: ${JSON.stringify({ type: 'CONNECTED' })}\n\n`);
            if (activeGameInfo) {
                res.write(`data: ${JSON.stringify({ type: 'GAME_STARTED', ...activeGameInfo })}\n\n`);
            } else {
                // Sincroniza clientes que se reconectan y limpia overlays obsoletos.
                res.write(`data: ${JSON.stringify({ type: 'GAME_CLOSED' })}\n\n`);
            }
            if (radarActive) {
                res.write(`data: ${JSON.stringify({ type: 'WATCHER_STATUS', active: true, system: expectedSystem })}\n\n`);
            }
            sseClients.add(res);

            req.on('close', () => {
                sseClients.delete(res);
                if (sseClients.size === 0 && process.argv.includes('--app')) {
                    shutdownTimer = setTimeout(() => {
                        if (sseClients.size === 0) process.exit(0);
                    }, 4000);
                }
            });
            return;
        }

        if (req.method === 'GET' && pathname === '/api/catalog') {
            const games = await syncGamesFromDisk();
            return sendJson(req, res, 200, games);
        }

        if (req.method === 'GET' && pathname === '/api/health') {
            return sendJson(req, res, 200, { ok: true, port: PORT, packaged: PACKAGED, pid: process.pid });
        }

        if (req.method === 'GET' && pathname === '/api/status') {
            return sendJson(req, res, 200, await buildEmulatorStatus());
        }

        if (req.method === 'POST' && pathname === '/api/system/open-folder') {
            const { target } = await readBody(req);
            const dir = openFolder(target);
            return sendJson(req, res, 200, { opened: true, dir });
        }

        if (req.method === 'GET' && pathname === '/api/sources') {
            try {
                const raw = await fsp.readFile(SOURCES_PATH, 'utf-8');
                return sendJson(req, res, 200, JSON.parse(raw));
            } catch {
                return sendJson(req, res, 200, {});
            }
        }

        if (req.method === 'POST' && pathname.startsWith('/api/play/')) {
            const gameId = decodeURIComponent(pathname.replace('/api/play/', ''));
            const result = await launchGameById(gameId);
            return sendJson(req, res, 200, result);
        }

        if (req.method === 'POST' && pathname === '/api/game/stop') {
            const stopped = stopActiveGame();
            return sendJson(req, res, 200, { stopped });
        }

        if (req.method === 'DELETE' && pathname.startsWith('/api/game/')) {
            const gameId = decodeURIComponent(pathname.replace('/api/game/', ''));
            const deleted = await deleteGameFromCatalog(gameId);
            if (!deleted) {
                return sendJson(req, res, 404, { error: 'El juego ya no existe en la biblioteca' });
            }
            publishEvent({ type: 'GAME_DELETED', gameId });
            return sendJson(req, res, 200, { deleted: true });
        }

        if (req.method === 'POST' && pathname === '/api/radar/start') {
            const { system, url } = await readBody(req);
            expectedSystem = system || null;
            radarActive = true;
            if (url) openExternalBrowser(url);
            publishEvent({ type: 'WATCHER_STATUS', active: true, system: expectedSystem });
            return sendJson(req, res, 200, { active: true, system: expectedSystem });
        }

        if (req.method === 'POST' && pathname === '/api/radar/stop') {
            expectedSystem = null;
            radarActive = false;
            publishEvent({ type: 'WATCHER_STATUS', active: false, system: null });
            return sendJson(req, res, 200, { active: false });
        }

        if (req.method === 'POST' && pathname === '/api/radar/scan') {
            if (!fs.existsSync(DOWNLOADS_DIR)) {
                return sendJson(req, res, 200, { found: 0, names: [] });
            }

            const entries = await fsp.readdir(DOWNLOADS_DIR, { withFileTypes: true });
            const names = [];
            const ignored = [];
            const maxAgeMs = 7 * 24 * 60 * 60 * 1000;

            for (const entry of entries) {
                if (!entry.isFile()) continue;
                const name = entry.name;
                const ext = path.extname(name).toLowerCase();
                if (!ARCHIVE_EXTS.includes(ext) && !ROM_EXTS.has(ext)) continue;
                if (isJunkDownloadName(name)) {
                    ignored.push(name);
                    continue;
                }

                const fullPath = path.join(DOWNLOADS_DIR, name);
                const st = await fsp.stat(fullPath).catch(() => null);
                if (!st || !st.isFile()) continue;

                // Ignora archivos viejos que el usuario ya tenía olvidados en Descargas.
                if (Date.now() - st.mtimeMs > maxAgeMs) {
                    ignored.push(name);
                    continue;
                }

                names.push(name);
                importDownloadedFile(fullPath, false);
            }

            return sendJson(req, res, 200, { found: names.length, names, ignored });
        }

        await serveStatic(req, res, pathname);
    } catch (err) {
        sendJson(req, res, 400, { error: err.message });
    }
});

process.on('exit', stopMouseToRightStickBridge);

// Primer inicio: prepara carpetas y configuración de emuladores sin pisar
// ajustes existentes del usuario.
const createdPcsx2Config = await ensurePcsx2FirstRunConfig().catch(() => false);
const createdDolphinFlag = await ensureDolphinPortableMode().catch(() => false);
if (createdPcsx2Config) console.log('Configuración inicial de PCSX2 copiada a Documentos\\PCSX2');
if (createdDolphinFlag) console.log('Dolphin activado en modo portable');

await fsp.mkdir(GAMES_DIR, { recursive: true });
const initialGames = await syncGamesFromDisk();
console.log(`Juegos detectados en disco: ${initialGames.length}`);
console.log(`Carpeta de datos: ${DATA_DIR}`);
console.log(`Emuladores: ${EMULATORS_DIR}`);
startDownloadsRadar();

server.listen(PORT, () => {
    console.log(`MegaRetro Hub activo en http://localhost:${PORT}`);
    if (process.argv.includes('--app') && !process.env.MEGARETRO_DESKTOP) {
        setTimeout(() => {
            openDesktopWindow(`http://localhost:${PORT}`);
        }, 400);
    }
});