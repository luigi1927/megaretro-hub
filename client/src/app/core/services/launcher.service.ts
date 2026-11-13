import { Injectable, signal, computed, OnDestroy, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RetroGame, LauncherEvent } from '../models/game.model';

@Injectable({ providedIn: 'root' })
export class LauncherService implements OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly apiUrl = 'http://localhost:3333/api';
  private eventSource: EventSource | null = null;

  // Estado reactivo con Angular Signals
  readonly games = signal<RetroGame[]>([]);
  readonly selectedSystem = signal<string>('ALL');
  readonly searchQuery = signal<string>('');
  readonly activeGameTitle = signal<string | null>(null);
  readonly toastMessage = signal<string | null>(null);

  // Estado del asistente de descargas y radar
  readonly showGetGamesModal = signal<boolean>(false);
  readonly radarActive = signal<boolean>(false);
  readonly radarSystem = signal<string | null>(null);
  readonly importingStatus = signal<string | null>(null);
  readonly webSources = signal<Record<string, string>>({
    PS1: 'https://archive.org/details/psx-redump',
    SNES: 'https://archive.org/details/no-intro-nintendo-super-nintendo-entertainment-system',
    GBA: 'https://archive.org/details/no-intro-nintendo-game-boy-advance',
    N64: 'https://archive.org/details/no-intro-nintendo-nintendo-64',
    PSP: 'https://archive.org/details/psp-redump',
    PS2: 'https://archive.org/details/ps2-redump'
  });

  readonly systems = computed(() => {
    const unique = new Set(this.games().map((g) => g.system));
    return ['ALL', ...Array.from(unique)];
  });

  readonly filteredGames = computed(() => {
    const sys = this.selectedSystem();
    const query = this.searchQuery().toLowerCase().trim();

    return this.games().filter((game) => {
      const matchSystem = sys === 'ALL' || game.system === sys;
      const matchQuery = !query || game.title.toLowerCase().includes(query);
      return matchSystem && matchQuery;
    });
  });

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.loadCatalog();
      this.loadSources();
      this.connectSSE();
    }
  }

  async loadCatalog(): Promise<void> {
    try {
      const res = await fetch(`${this.apiUrl}/catalog`);
      if (!res.ok) throw new Error();
      const data: RetroGame[] = await res.json();
      this.games.set(data);
    } catch {
      this.showToast('⚠️ No se pudo conectar con el servidor Node.js (puerto 3333)');
    }
  }

  async loadSources(): Promise<void> {
    try {
      const res = await fetch(`${this.apiUrl}/sources`);
      if (res.ok) {
        this.webSources.set(await res.json());
      }
    } catch {
      // Mantiene las fuentes por defecto si el endpoint aún no responde
    }
  }

  async playOrDownload(game: RetroGame): Promise<void> {
    if (game.downloading || game.extracting) return;

    try {
      const res = await fetch(`${this.apiUrl}/play/${encodeURIComponent(game.id)}`, {
        method: 'POST'
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        this.showToast(err.error || 'No se pudo iniciar el juego');
      }
    } catch {
      this.showToast('Error de red al intentar iniciar el emulador');
    }
  }

  async uninstallGame(game: RetroGame): Promise<void> {
    if (!game.installed || game.downloading) return;
    try {
      await fetch(`${this.apiUrl}/game/${encodeURIComponent(game.id)}`, {
        method: 'DELETE'
      });
    } catch {
      this.showToast('No se pudo eliminar la ROM');
    }
  }

  async openWebPortalAndWatch(system: string, customUrl?: string): Promise<void> {
    const url = (customUrl || '').trim() || this.webSources()[system] || 'https://archive.org';
    try {
      await fetch(`${this.apiUrl}/radar/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system, url })
      });
      this.radarActive.set(true);
      this.radarSystem.set(system);
      this.showGetGamesModal.set(false);
    } catch {
      this.showToast('No se pudo activar el radar de descargas');
    }
  }

  async stopRadar(): Promise<void> {
    try {
      await fetch(`${this.apiUrl}/radar/stop`, { method: 'POST' });
    } finally {
      this.radarActive.set(false);
      this.radarSystem.set(null);
    }
  }

  private connectSSE(): void {
    this.eventSource = new EventSource(`${this.apiUrl}/events`);

    this.eventSource.onmessage = (event) => {
      const payload: LauncherEvent = JSON.parse(event.data);
      this.handleBackendEvent(payload);
    };

    this.eventSource.onerror = () => {
      this.showToast('Reconectando con el servicio local...');
    };
  }

  async scanDownloadsFolder(): Promise<void> {
    const res = await fetch(`${this.apiUrl}/radar/scan`, { method: 'POST' });
    const data = await res.json();
    this.showToast(
      data.found > 0
        ? `🔍 Importando ${data.found} archivo(s) encontrado(s) en Descargas...`
        : 'No se encontraron ROMs nuevas en Descargas (últimas 24h)'
    );
  }

  private handleBackendEvent(ev: LauncherEvent): void {
    switch (ev.type) {
      case 'WATCHER_STATUS':
        this.radarActive.set(Boolean(ev.active));
        this.radarSystem.set(ev.system || null);
        break;

      case 'IMPORT_STARTED':
        this.importingStatus.set(ev.message || 'Extrayendo e importando juego...');
        break;

      case 'GAME_IMPORTED':
        this.importingStatus.set(null);
        if (ev.game) {
          this.games.update((list) => [ev.game!, ...list]);
          this.selectedSystem.set(ev.game.system);
          this.showToast(`✅ "${ev.game.title}" importado y listo para jugar`);
        }
        break;

      case 'DOWNLOAD_START':
        this.patchGame(ev.gameId!, { downloading: true, progress: 0 });
        break;

      case 'DOWNLOAD_PROGRESS':
        this.patchGame(ev.gameId!, { downloading: true, progress: ev.progress ?? 0 });
        break;

      case 'EXTRACTING':
        this.patchGame(ev.gameId!, { downloading: false, extracting: true, progress: 100 });
        break;

      case 'DOWNLOAD_COMPLETE':
        this.patchGame(ev.gameId!, {
          downloading: false,
          extracting: false,
          installed: true,
          progress: 100
        });
        break;

      case 'DOWNLOAD_ERROR':
        this.patchGame(ev.gameId!, { downloading: false, extracting: false, progress: 0 });
        this.showToast(ev.message || 'Error durante la descarga');
        break;

      case 'GAME_DELETED':
        this.patchGame(ev.gameId!, { installed: false, progress: 0 });
        this.showToast('ROM eliminada del disco local');
        break;

      case 'GAME_STARTED':
        this.activeGameTitle.set(ev.title || 'Juego en curso');
        break;

      case 'GAME_CLOSED':
        this.activeGameTitle.set(null);
        break;

      case 'GAME_ERROR':
      case 'ERROR_TOAST':
        this.importingStatus.set(null);
        this.activeGameTitle.set(null);
        this.showToast(ev.message || 'Error inesperado en el servidor');
        break;
    }
  }

  private patchGame(gameId: string, changes: Partial<RetroGame>): void {
    this.games.update((list) =>
      list.map((item) => (item.id === gameId ? { ...item, ...changes } : item))
    );
  }

  showToast(msg: string): void {
    this.toastMessage.set(msg);
    setTimeout(() => {
      if (this.toastMessage() === msg) {
        this.toastMessage.set(null);
      }
    }, 4500);
  }

  ngOnDestroy(): void {
    this.eventSource?.close();
  }
}
