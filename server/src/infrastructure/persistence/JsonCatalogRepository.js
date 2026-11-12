import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { Game } from '../../domain/entities/Game.js';
import { PathSanitizer } from '../security/PathSanitizer.js';

export class JsonCatalogRepository {
    #catalogPath;
    #gamesBaseDir;

    constructor(catalogPath, gamesBaseDir) {
        this.#catalogPath = catalogPath;
        this.#gamesBaseDir = gamesBaseDir;
    }

    async findAll() {
        if (!fs.existsSync(this.#catalogPath)) {
            await fsp.writeFile(this.#catalogPath, '[]', 'utf-8');
        }
        const raw = await fsp.readFile(this.#catalogPath, 'utf-8');
        const items = JSON.parse(raw);

        return items.map((item) => {
            const game = new Game(item);
            const romPath = PathSanitizer.resolveInside(
                this.#gamesBaseDir,
                game.system.toLowerCase(),
                game.executableFile
            );
            return {
                ...game,
                installed: fs.existsSync(romPath)
            };
        });
    }

    async findById(gameId) {
        const all = await this.findAll();
        return all.find((g) => g.id === gameId) || null;
    }

    async save(gameEntity) {
        const validGame = new Game(gameEntity);
        const raw = await fsp.readFile(this.#catalogPath, 'utf-8');
        const items = JSON.parse(raw);
        items.unshift(validGame);
        await fsp.writeFile(this.#catalogPath, JSON.stringify(items, null, 2), 'utf-8');
        return validGame;
    }

    async deleteById(gameId) {
        const game = await this.findById(gameId);
        if (!game) return false;

        const romPath = PathSanitizer.resolveInside(
            this.#gamesBaseDir,
            game.system.toLowerCase(),
            game.executableFile
        );

        if (fs.existsSync(romPath)) {
            await fsp.unlink(romPath);
        }

        const raw = await fsp.readFile(this.#catalogPath, 'utf-8');
        const items = JSON.parse(raw).filter((g) => g.id !== gameId);
        await fsp.writeFile(this.#catalogPath, JSON.stringify(items, null, 2), 'utf-8');
        return true;
    }
}