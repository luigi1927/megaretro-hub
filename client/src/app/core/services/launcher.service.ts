import { Injectable, signal, computed, OnDestroy, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RetroGame, LauncherEvent, SystemStatus } from '../models/game.model';

@Injectable({ providedIn: 'root' })
export class LauncherService implements OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  // El frontend siempre lo sirve el mismo servidor Node, así que las rutas
  // relativas funcionan igual en localhost:3333 y en el puerto que elija Electron.
  private readonly apiUrl = '/api';
  private eventSource: EventSource | null = null;

  // Estado reactivo con Angular Signals
  readonly games = signal<RetroGame[]>([]);
  readonly selectedSystem = signal<string>('ALL');
  readonly searchQuery = signal<string>('');
  readonly activeGameTitle = signal<string | null>(null);
  readonly toastMessage = signal<string | null>(null);
  readonly systemStatus = signal<SystemStatus | null>(null);
  readonly showStatusModal = signal<boolean>(false);

  // Estado del asistente de descargas y radar
  readonly showGetGamesModal = signal<boolean>(false);
  readonly radarActive = signal<boolean>(false);
  readonly radarSystem = signal<string | null>(null);
  readonly importingStatus = signal<string | null>(null);
  readonly refreshing = signal<boolean>(false);
  readonly scanning = signal<boolean>(false);
  readonly pendingDelete = signal<RetroGame | null>(null);
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

  async loadCatalog(showFeedback = false): Promise<void> {
    this.refreshing.set(true);
    try {
      const res = await fetch(`${this.apiUrl}/catalog`);
      if (!res.ok) throw new Error();
      const data: RetroGame[] = await res.json();
      this.games.set(data.filter((game) => game.installed !== false));
      if (showFeedback) {
        this.showToast(`🔄 Biblioteca actualizada: ${data.length} juego(s)`);
      }
    } catch {
      this.showToast('⚠️ No se pudo conectar con el servidor Node.js (puerto 3333)');
    } finally {
      this.refreshing.set(false);
    }
  }

  async refreshLibrary(): Promise<void> {
    if (this.refreshing()) return;
    await this.loadCatalog(true);
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

  async closeActiveGame(): Promise<void> {
    // Quita el overlay de inmediato para que la interfaz nunca quede atrapada.
    this.activeGameTitle.set(null);
    try {
      await fetch(`${this.apiUrl}/game/stop`, { method: 'POST' });
    } catch {
      // Si el servidor no responde, la interfaz ya quedó liberada.
    }
  }

  requestUninstall(game: RetroGame): void {
    if (!game.installed || game.downloading) return;
    this.pendingDelete.set(game);
  }

  cancelUninstall(): void {
    this.pendingDelete.set(null);
  }

  async confirmUninstall(): Promise<void> {
    const game = this.pendingDelete();
    if (!game) return;
    this.pendingDelete.set(null);

    try {
      await fetch(`${this.apiUrl}/game/${encodeURIComponent(game.id)}`, {
        method: 'DELETE'
      });
      this.games.update((list) => list.filter((item) => item.id !== game.id));
      this.showToast(`🗑️ "${game.title}" eliminado de la biblioteca`);
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
    if (this.scanning()) return;
    this.scanning.set(true);

    try {
      const res = await fetch(`${this.apiUrl}/radar/scan`, { method: 'POST' });
      const data = await res.json();
      const found = Number(data.found) || 0;

      if (found > 0) {
        this.showToast(`🔍 Importando ${found} archivo(s) de Descargas...`);
      } else if (Array.isArray(data.ignored) && data.ignored.length > 0) {
        this.showToast('No se encontraron ROMs nuevas. Se ignoraron BIOS, manuales y archivos antiguos.');
      } else {
        this.showToast('No se encontraron ROMs nuevas en Descargas (últimos 7 días)');
      }
    } catch {
      this.showToast('No se pudo escanear la carpeta Descargas');
    } finally {
      this.scanning.set(false);
    }
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
          const imported = ev.game;
          const normalize = (game: RetroGame) =>
            `${game.system}|${game.executableFile}`.toLowerCase();
          this.games.update((list) => [
            imported,
            ...list.filter(
              (item) => item.id !== imported.id && normalize(item) !== normalize(imported)
            )
          ]);
          this.selectedSystem.set(imported.system);
          this.showToast(`✅ "${imported.title}" importado y listo para jugar`);
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
        this.games.update((list) => list.filter((item) => item.id !== ev.gameId));
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
