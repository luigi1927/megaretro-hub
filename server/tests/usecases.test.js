import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LaunchGameUseCase } from '../src/application/LaunchGameUseCase.js';
import { Game } from '../src/domain/entities/Game.js';

describe('LaunchGameUseCase (Clean Architecture + Mocks)', () => {
    it('debe lanzar el emulador cuando el juego existe y la ROM está en disco', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retro-test-'));
        const ps1Dir = path.join(tmpDir, 'ps1');
        fs.mkdirSync(ps1Dir, { recursive: true });
        const romFile = path.join(ps1Dir, 'tekken3.chd');
        fs.writeFileSync(romFile, 'DUMMY_ROM_DATA');

        const mockGame = new Game({
            id: 'ps1-tekken-3',
            title: 'Tekken 3',
            system: 'PS1',
            emulator: 'retroarch',
            core: 'swanstation_libretro.dll',
            executableFile: 'tekken3.chd'
        });

        const events = [];
        let launchedPath = null;

        const useCase = new LaunchGameUseCase({
            catalogRepo: { findById: async () => mockGame },
            emulatorRunner: {
                launch: async (_game, romPath, onClose) => {
                    launchedPath = romPath;
                    onClose(0);
                }
            },
            gamesBaseDir: tmpDir,
            eventPublisher: { publish: (ev) => events.push(ev) }
        });

        const result = await useCase.execute('ps1-tekken-3');
        assert.equal(result.launched, true);
        assert.equal(launchedPath, romFile);
        assert.equal(events[0].type, 'GAME_STARTED');
        assert.equal(events[1].type, 'GAME_CLOSED');

        fs.rmSync(tmpDir, { recursive: true, force: true });
    });
}); 