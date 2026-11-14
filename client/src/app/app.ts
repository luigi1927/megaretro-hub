import { Component, inject, signal, effect, HostListener, untracked } from '@angular/core';
import { LauncherService } from './core/services/launcher.service';
import { GamepadService, GamepadAction } from './core/services/gamepad.service';
import { RetroGame } from './core/models/game.model';
import { DownloadWizardComponent } from './features/launcher/components/download-wizard.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [DownloadWizardComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  readonly launcher = inject(LauncherService);
  readonly gamepad = inject(GamepadService);
  readonly focusedIndex = signal<number>(0);

  constructor() {
    effect(() => {
      const ev = this.gamepad.lastAction();
      if (!ev) return;
      // untracked evita que las señales modificadas dentro del manejador
      // vuelvan a disparar este effect (bucle infinito con el mando).
      untracked(() => this.handleNavigationAction(ev.action));
    });

    effect(() => {
      const total = this.launcher.filteredGames().length;
      if (this.focusedIndex() >= total) {
        this.focusedIndex.set(Math.max(0, total - 1));
      }
    });
  }

  selectSystem(sys: string): void {
    this.launcher.selectedSystem.set(sys);
    this.focusedIndex.set(0);
  }

  onSearch(val: string): void {
    this.launcher.searchQuery.set(val);
    this.focusedIndex.set(0);
  }

  requestDelete(game: RetroGame): void {
    this.launcher.requestUninstall(game);
  }

  confirmDelete(): void {
    this.launcher.confirmUninstall();
  }

  cancelDelete(): void {
    this.launcher.cancelUninstall();
  }

  onCardMouseMove(event: MouseEvent): void {
    const card = event.currentTarget as HTMLElement;
    const rect = card.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;

    const rotateY = (x - 0.5) * 20;
    const rotateX = (0.5 - y) * 20;

    card.style.setProperty('--rx', `${rotateX.toFixed(2)}deg`);
    card.style.setProperty('--ry', `${rotateY.toFixed(2)}deg`);
    card.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
    card.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
  }

  onCardMouseLeave(event: MouseEvent): void {
    const card = event.currentTarget as HTMLElement;
    card.style.setProperty('--rx', '0deg');
    card.style.setProperty('--ry', '0deg');
    card.style.setProperty('--mx', '50%');
    card.style.setProperty('--my', '0%');
  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    const tag = (event.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    if (this.launcher.activeGameTitle()) {
      if (event.key === 'Escape') {
        event.preventDefault();
        void this.launcher.closeActiveGame();
      }
      return;
    }

    if (this.launcher.pendingDelete()) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.cancelDelete();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        this.confirmDelete();
      }
      return;
    }

    if (event.key === 'Escape' && this.launcher.showGetGamesModal()) {
      this.launcher.showGetGamesModal.set(false);
      return;
    }

    if ((event.key === 'r' || event.key === 'R') && !event.ctrlKey && !event.metaKey) {
      this.launcher.refreshLibrary();
      return;
    }

    const keyMap: Record<string, GamepadAction> = {
      ArrowLeft: 'LEFT',
      ArrowRight: 'RIGHT',
      ArrowUp: 'UP',
      ArrowDown: 'DOWN',
      Enter: 'CONFIRM',
      Escape: 'BACK',
      Delete: 'DELETE'
    };

    const action = keyMap[event.key];
    if (action) {
      event.preventDefault();
      this.handleNavigationAction(action);
    }
  }

  private handleNavigationAction(action: GamepadAction): void {
    if (this.launcher.pendingDelete()) {
      if (action === 'CONFIRM') this.confirmDelete();
      else if (action === 'BACK') this.cancelDelete();
      return;
    }

    if (this.launcher.showGetGamesModal()) {
      if (action === 'BACK') {
        this.launcher.showGetGamesModal.set(false);
      }
      return;
    }

    if (this.launcher.activeGameTitle()) {
      if (action === 'EXIT') void this.launcher.closeActiveGame();
      return;
    }

    const games = this.launcher.filteredGames();
    const systems = this.launcher.systems();

    if ((action === 'UP' || action === 'DOWN') && systems.length > 1) {
      const idx = systems.indexOf(this.launcher.selectedSystem());
      const step = action === 'DOWN' ? 1 : -1;
      const nextIdx = (idx + step + systems.length) % systems.length;
      this.selectSystem(systems[nextIdx]);
      return;
    }

    if (games.length === 0) return;

    const current = Math.min(this.focusedIndex(), games.length - 1);

    switch (action) {
      case 'LEFT':
        this.focusedIndex.set(current > 0 ? current - 1 : games.length - 1);
        break;
      case 'RIGHT':
        this.focusedIndex.set(current < games.length - 1 ? current + 1 : 0);
        break;
      case 'CONFIRM':
        this.launcher.playOrDownload(games[current]);
        break;
      case 'DELETE':
        this.launcher.requestUninstall(games[current]);
        break;
    }
  }
}
