import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { PathSanitizer } from '../security/PathSanitizer.js';

export class ProcessEmulatorRunner {
    #emulatorsBaseDir;
    #activeProcess = null;

    constructor(emulatorsBaseDir) {
        this.#emulatorsBaseDir = emulatorsBaseDir;
    }

    #buildCommand(game, romPath) {
        const strategies = {
            retroarch: () => {
                const corePath = PathSanitizer.resolveInside(
                    this.#emulatorsBaseDir,
                    'retroarch',
                    'cores',
                    game.core
                );
                return {
                    cwd: PathSanitizer.resolveInside(this.#emulatorsBaseDir, 'retroarch'),
                    bin: PathSanitizer.resolveInside(
                        this.#emulatorsBaseDir,
                        'retroarch',
                        process.platform === 'win32' ? 'retroarch.exe' : 'retroarch'
                    ),
                    args: ['-f', '-L', corePath, romPath]
                };
            },
            pcsx2: () => ({
                cwd: PathSanitizer.resolveInside(this.#emulatorsBaseDir, 'pcsx2'),
                bin: PathSanitizer.resolveInside(this.#emulatorsBaseDir, 'pcsx2', 'pcsx2-qt.exe'),
                args: ['-batch', '-fullscreen', romPath]
            }),
            dolphin: () => ({
                cwd: PathSanitizer.resolveInside(this.#emulatorsBaseDir, 'dolphin'),
                bin: PathSanitizer.resolveInside(this.#emulatorsBaseDir, 'dolphin', 'Dolphin.exe'),
                args: ['-b', '-e', romPath]
            })
        };

        const builder = strategies[game.emulator];
        if (!builder) {
            throw new Error(`Estrategia de ejecución no definida para ${game.emulator}`);
        }
        return builder();
    }

    async launch(game, romPath, onClose) {
        if (this.#activeProcess) {
            throw new Error('Ya existe un emulador en ejecución.');
        }

        const { cwd, bin, args } = this.#buildCommand(game, romPath);
        if (!fs.existsSync(bin)) {
            throw new Error(`Ejecutable del emulador no encontrado: ${path.basename(bin)}`);
        }

        // shell: false impide cualquier inyección de comandos de shell (CWE-78)
        this.#activeProcess = spawn(bin, args, { cwd, shell: false, detached: false });

        this.#activeProcess.on('close', (code) => {
            this.#activeProcess = null;
            if (onClose) onClose(code);
        });

        this.#activeProcess.on('error', () => {
            this.#activeProcess = null;
            if (onClose) onClose(-1);
        });
    }
}