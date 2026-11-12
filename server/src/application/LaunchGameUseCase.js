import fs from 'node:fs';
import { PathSanitizer } from '../infrastructure/security/PathSanitizer.js';

export class LaunchGameUseCase {
    #catalogRepo;
    #emulatorRunner;
    #gamesBaseDir;
    #eventPublisher;

    constructor({ catalogRepo, emulatorRunner, gamesBaseDir, eventPublisher }) {
        this.#catalogRepo = catalogRepo;
        this.#emulatorRunner = emulatorRunner;
        this.#gamesBaseDir = gamesBaseDir;
        this.#eventPublisher = eventPublisher;
    }

    async execute(rawGameId) {
        const gameId = PathSanitizer.sanitizeSlug(rawGameId);
        const game = await this.#catalogRepo.findById(gameId);

        if (!game) {
            throw new Error('El juego solicitado no existe en el catálogo.');
        }

        const romPath = PathSanitizer.resolveInside(
            this.#gamesBaseDir,
            game.system.toLowerCase(),
            game.executableFile
        );

        if (!fs.existsSync(romPath)) {
            throw new Error('La ROM no se encuentra instalada en el disco local.');
        }

        this.#eventPublisher.publish({
            type: 'GAME_STARTED',
            gameId: game.id,
            title: game.title
        });

        await this.#emulatorRunner.launch(game, romPath, (exitCode) => {
            this.#eventPublisher.publish({
                type: 'GAME_CLOSED',
                gameId: game.id,
                exitCode
            });
        });

        return { launched: true, gameId: game.id };
    }
}