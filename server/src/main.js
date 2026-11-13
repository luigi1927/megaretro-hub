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

const PORT = 3333;

const CLIENT_DIST_DIR = path.join(ROOT_DIR, 'client', 'dist', 'client', 'browser');
const CLIENT_DIST_FALLBACK = path.join(ROOT_DIR, 'client', 'dist', 'client');
const GAMES_DIR = path.join(ROOT_DIR, 'games');
const EMULATORS_DIR = path.join(ROOT_DIR, 'emulators');
const CATALOG_PATH = path.join(ROOT_DIR, 'server', 'catalog.json');
const SOURCES_PATH = path.join(ROOT_DIR, 'server', 'sources.json');
const DOWNLOADS_DIR = path.join(os.homedir(), 'Downloads');

const ARCHIVE_EXTS = ['.zip', '.7z'];

const EXT_PROFILES = {
    '.cue': { system: 'PS1', emulator: 'retroarch', core: 'swanstation_libretro.dll', dir: 'Sony - PlayStation' },
    '.chd': { system: 'PS1', emulator: 'retroarch', core: 'swanstation_libretro.dll', dir: 'Sony - PlayStation' },
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

    if (fs.existsSync(GAMES_DIR)) {
        const allGameFiles = await walkFiles(GAMES_DIR);
        const romFiles = allGameFiles.filter((f) => Boolean(EXT_PROFILES[path.extname(f).toLowerCase()]));

        for (const romFile of romFiles) {
            const romExt = path.extname(romFile).toLowerCase();
            const profile = EXT_PROFILES[romExt];
            const relFromGames = path.relative(GAMES_DIR, romFile);
            const parts = relFromGames.split(path.sep);

            const firstFolder = parts.length > 1 ? parts[0].toUpperCase() : profile.system;
            const system = Object.values(EXT_PROFILES).some((p) => p.system === firstFolder)
                ? firstFolder
                : profile.system;

            const sysDirPath = path.join(GAMES_DIR, system.toLowerCase());
            const relExec = parts.length > 1 ? parts.slice(1).join('/') : path.basename(romFile);

            const parentFolder = path.dirname(romFile);
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
                (g) => g.system.toUpperCase() === system && g.executableFile === relExec
            );

            if (existing) {
                if (existing.sizeMB !== sizeMB && sizeMB > 0) {
                    existing.sizeMB = sizeMB;
                    modified = true;
                }
            } else {
                const cleanTitle = path.parse(romFile).name.replace(/\s*[\(\[].*?[\)\]]/g, '').trim();
                const slug = sanitizeSlug(cleanTitle);
                const coverUrl = `https://thumbnails.libretro.com/${encodeURIComponent(profile.dir)}/Named_Boxarts/${encodeURIComponent(cleanTitle + ' (USA)')}.png`;

                catalog.push({
                    id: `${system.toLowerCase()}-${slug}-${Date.now().toString(36)}`,
                    title: cleanTitle,
                    system,
                    year: new Date().getFullYear(),
                    sizeMB,
                    emulator: system === 'PS1' ? 'retroarch' : profile.emulator,
                    core: system === 'PS1' ? 'swanstation_libretro.dll' : profile.core,
                    coverUrl,
                    executableFile: relExec
                });
                modified = true;
            }
        }
    }

    if (modified) {
        await writeCatalog(catalog);
    }

    return catalog.map((game) => {
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
    if (game) {
        const gameFolder = resolveInside(
            GAMES_DIR,
            game.system.toLowerCase(),
            path.dirname(game.executableFile)
        );
        const sysRoot = resolveInside(GAMES_DIR, game.system.toLowerCase());
        if (gameFolder !== sysRoot) {
            await fsp.rm(gameFolder, { recursive: true, force: true }).catch(() => { });
        } else {
            const singleFile = resolveInside(GAMES_DIR, game.system.toLowerCase(), game.executableFile);
            await fsp.rm(singleFile, { force: true }).catch(() => { });
        }
    }
    await writeCatalog(catalog.filter((g) => g.id !== gameId));
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
        // Ventana redimensionable
        video_fullscreen: '"false"',
        video_windowed_fullscreen: '"false"',
        video_window_show_decorations: '"true"',
        video_window_save_positions: '"true"',
        video_window_custom_size_enable: '"false"',
        video_scale: '"3"',
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

    // SwanStation (PS1): Activar mando DualShock con ambos sticks activos
    await fsp.mkdir(coreOptDir, { recursive: true });
    let optContent = fs.existsSync(coreOptPath) ? await fsp.readFile(coreOptPath, 'utf-8') : '';
    const ps1Opts = {
        duckstation_Controller1_Type: '"AnalogController"',
        duckstation_Controller1_ForceAnalogOnReset: '"true"'
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

// --- Ejecución de Emulador ---
let activeEmulatorProcess = null;

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
        cwd = resolveInside(EMULATORS_DIR, 'pcsx2');
        bin = resolveInside(cwd, 'pcsx2-qt.exe');
        args = ['-batch', romPath];
    } else if (game.emulator === 'dolphin') {
        cwd = resolveInside(EMULATORS_DIR, 'dolphin');
        bin = resolveInside(cwd, 'Dolphin.exe');
        args = ['-e', romPath];
    } else {
        throw new Error(`Emulador no soportado: ${game.emulator}`);
    }

    publishEvent({ type: 'GAME_STARTED', gameId: game.id, title: game.title });

    activeEmulatorProcess = spawn(bin, args, { cwd, shell: false, detached: false });

    activeEmulatorProcess.on('close', () => {
        activeEmulatorProcess = null;
        stopMouseToRightStickBridge();
        setTimeout(() => {
            publishEvent({ type: 'GAME_CLOSED', gameId: game.id });
        }, 300);
    });

    activeEmulatorProcess.on('error', (err) => {
        activeEmulatorProcess = null;
        stopMouseToRightStickBridge();
        publishEvent({ type: 'GAME_ERROR', message: `Error al abrir emulador: ${err.message}` });
    });

    return { launched: true, title: game.title };
}

// --- Extracción e Importación Automática (ZIP / 7z / ROMs) ---
const activeImports = new Set();
let expectedSystem = null;
let radarActive = false;
let shutdownTimer = null;

async function extractArchiveSafely(archivePath, destDir) {
    const is7z = archivePath.toLowerCase().endsWith('.7z');

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
        if (is7z) {
            throw new Error(`No se pudo extraer el archivo .7z: ${err.message}`);
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

        const filename = path.basename(sourcePath);
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
        const romFile =
            allFiles.find((f) => ['.cue', '.chd'].includes(path.extname(f).toLowerCase())) ||
            allFiles.find((f) => EXT_PROFILES[path.extname(f).toLowerCase()]);

        if (!romFile) {
            throw new Error('El archivo comprimido no contiene una ROM compatible.');
        }

        const romExt = path.extname(romFile).toLowerCase();
        const profile = EXT_PROFILES[romExt];
        const system = expectedSystem || profile.system;
        const cleanTitle = path.parse(romFile).name.replace(/\s*[\(\[].*?[\)\]]/g, '').trim();
        const slug = sanitizeSlug(cleanTitle);

        const targetDir = resolveInside(GAMES_DIR, system.toLowerCase(), slug);
        await fsp.mkdir(targetDir, { recursive: true });

        let totalBytes = 0;
        for (const srcFile of allFiles) {
            const stat = await fsp.stat(srcFile);
            totalBytes += stat.size;
            const destFile = resolveInside(targetDir, path.basename(srcFile));
            await fsp.rm(destFile, { force: true }).catch(() => { });
            await fsp.rename(srcFile, destFile);
        }

        if (romExt === '.cue' && totalBytes < 1_048_576) {
            throw new Error('El archivo .cue no venía acompañado de su archivo .bin completo.');
        }

        const coverUrl = `https://thumbnails.libretro.com/${encodeURIComponent(profile.dir)}/Named_Boxarts/${encodeURIComponent(cleanTitle + ' (USA)')}.png`;

        const savedGame = await saveGameToCatalog({
            id: `${system.toLowerCase()}-${slug}-${Date.now().toString(36)}`,
            title: cleanTitle,
            system,
            year: new Date().getFullYear(),
            sizeMB: +(totalBytes / 1048576).toFixed(1),
            emulator: system === 'PS1' ? 'retroarch' : profile.emulator,
            core: system === 'PS1' ? 'swanstation_libretro.dll' : profile.core,
            coverUrl,
            executableFile: path.posix.join(slug, path.basename(romFile))
        });

        if (isArchive) {
            await fsp.unlink(sourcePath).catch(() => { });
        }

        publishEvent({ type: 'GAME_IMPORTED', game: { ...savedGame, installed: true } });
    } catch (err) {
        if (!silentIfNoRom || !err.message.includes('no contiene una ROM compatible')) {
            publishEvent({ type: 'ERROR_TOAST', message: err.message });
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
        if (!ARCHIVE_EXTS.includes(ext) && !EXT_PROFILES[ext]) return;

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
    const allowed = ['http://localhost:3333', 'http://127.0.0.1:3333'];
    res.setHeader(
        'Access-Control-Allow-Origin',
        origin && allowed.includes(origin) ? origin : 'http://localhost:3333'
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

        if (req.method === 'DELETE' && pathname.startsWith('/api/game/')) {
            const gameId = decodeURIComponent(pathname.replace('/api/game/', ''));
            await deleteGameFromCatalog(gameId);
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
                return sendJson(req, res, 200, { found: 0 });
            }
            const entries = await fsp.readdir(DOWNLOADS_DIR);
            let found = 0;
            for (const name of entries) {
                const ext = path.extname(name).toLowerCase();
                if (!ARCHIVE_EXTS.includes(ext) && !EXT_PROFILES[ext]) continue;
                const fullPath = path.join(DOWNLOADS_DIR, name);
                const st = await fsp.stat(fullPath).catch(() => null);
                if (st && st.isFile()) {
                    found++;
                    importDownloadedFile(fullPath, true);
                }
            }
            return sendJson(req, res, 200, { found });
        }

        await serveStatic(req, res, pathname);
    } catch (err) {
        sendJson(req, res, 400, { error: err.message });
    }
});

process.on('exit', stopMouseToRightStickBridge);

await fsp.mkdir(GAMES_DIR, { recursive: true });
const initialGames = await syncGamesFromDisk();
console.log(`Juegos detectados en disco: ${initialGames.length}`);
startDownloadsRadar();

server.listen(PORT, () => {
    console.log(`MegaRetro Hub activo en http://localhost:${PORT}`);
    if (process.argv.includes('--app')) {
        setTimeout(() => {
            openDesktopWindow(`http://localhost:${PORT}`);
        }, 400);
    }
});