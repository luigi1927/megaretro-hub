import { Component, inject, signal, HostListener, OnInit } from '@angular/core';
import { LauncherService } from './core/services/launcher.service';
import { GamepadService, GamepadAction } from './core/services/gamepad.service';
import { DownloadWizardComponent } from './features/launcher/components/download-wizard.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [DownloadWizardComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnInit {
  readonly launcher = inject(LauncherService);
  readonly gamepad = inject(GamepadService);
  readonly focusedIndex = signal<number>(0);

  ngOnInit(): void {
    this.gamepad.onAction((action) => this.handleNavigation(action));
  }

  selectSystem(sys: string): void {
    this.launcher.selectedSystem.set(sys);
    this.focusedIndex.set(0);
  }

  onSearch(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.launcher.searchQuery.set(val);
    this.focusedIndex.set(0);
  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(e: KeyboardEvent): void {
    if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'SELECT') {
      return;
    }

    const map: Record<string, GamepadAction> = {
      ArrowUp: 'UP',
      ArrowDown: 'DOWN',
      ArrowLeft: 'LEFT',
      ArrowRight: 'RIGHT',
      Enter: 'CONFIRM',
      Delete: 'DELETE',
      q: 'PREV_TAB',
      e: 'NEXT_TAB'
    };

    if (map[e.key]) {
      e.preventDefault();
      this.handleNavigation(map[e.key]);
    }
  }

  private handleNavigation(action: GamepadAction): void {
    if (this.launcher.showGetGamesModal()) return;

    const games = this.launcher.filteredGames();
    const systems = this.launcher.systems();

    if (action === 'PREV_TAB' || action === 'NEXT_TAB') {
      const idx = systems.indexOf(this.launcher.selectedSystem());
      const next =
        action === 'NEXT_TAB'
          ? (idx + 1) % systems.length
          : (idx - 1 + systems.length) % systems.length;
      this.selectSystem(systems[next]);
      return;
    }

    if (!games.length) return;

    const current = this.focusedIndex();
    const columns = 4;

    switch (action) {
      case 'RIGHT':
        this.focusedIndex.set(Math.min(games.length - 1, current + 1));
        break;
      case 'LEFT':
        this.focusedIndex.set(Math.max(0, current - 1));
        break;
      case 'DOWN':
        this.focusedIndex.set(Math.min(games.length - 1, current + columns));
        break;
      case 'UP':
        this.focusedIndex.set(Math.max(0, current - columns));
        break;
      case 'CONFIRM':
        this.launcher.playOrDownload(games[current]);
        break;
      case 'DELETE':
        this.launcher.uninstallGame(games[current]);
        break;
    }
  }
}