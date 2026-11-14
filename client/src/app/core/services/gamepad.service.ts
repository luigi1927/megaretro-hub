import { Injectable, signal, OnDestroy, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export type GamepadAction =
  | 'UP'
  | 'DOWN'
  | 'LEFT'
  | 'RIGHT'
  | 'CONFIRM'
  | 'BACK'
  | 'DELETE'
  | 'EXIT';

@Injectable({ providedIn: 'root' })
export class GamepadService implements OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  private rafId: number | null = null;
  private lastActionTime = 0;
  private readonly repeatDelayMs = 180;

  readonly connected = signal<boolean>(false);
  readonly controllerName = signal<string | null>(null);
  readonly lastAction = signal<{ action: GamepadAction; ts: number } | null>(null);

  private readonly onConnect = (e: GamepadEvent) => {
    this.connected.set(true);
    this.controllerName.set(this.cleanControllerName(e.gamepad.id));
    this.startPolling();
  };

  private readonly onDisconnect = () => {
    const active = this.getActiveGamepad();
    if (active) {
      this.connected.set(true);
      this.controllerName.set(this.cleanControllerName(active.id));
    } else {
      this.connected.set(false);
      this.controllerName.set(null);
      this.stopPolling();
    }
  };

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      window.addEventListener('gamepadconnected', this.onConnect);
      window.addEventListener('gamepaddisconnected', this.onDisconnect);

      // Comprobar si ya había un mando encendido antes de abrir la app
      const existing = this.getActiveGamepad();
      if (existing) {
        this.connected.set(true);
        this.controllerName.set(this.cleanControllerName(existing.id));
        this.startPolling();
      }
    }
  }

  private getActiveGamepad(): Gamepad | null {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    for (const pad of pads) {
      if (pad && pad.connected) return pad;
    }
    return null;
  }

  private cleanControllerName(rawId: string): string {
    return rawId.replace(/\s*\(.*?\)\s*/g, '').trim() || 'Mando conectado';
  }

  private startPolling(): void {
    if (this.rafId !== null) return;

    const loop = (now: number) => {
      const pad = this.getActiveGamepad();
      if (!pad) {
        this.connected.set(false);
        this.controllerName.set(null);
        this.rafId = null;
        return;
      }

      if (now - this.lastActionTime >= this.repeatDelayMs) {
        const action = this.readStandardMapping(pad);
        if (action) {
          this.lastActionTime = now;
          this.lastAction.set({ action, ts: now });
          window.dispatchEvent(new CustomEvent('megaretro:gamepad', { detail: action }));
        }
      }

      this.rafId = requestAnimationFrame(loop);
    };

    this.rafId = requestAnimationFrame(loop);
  }

  private readStandardMapping(pad: Gamepad): GamepadAction | null {
    const btn = (idx: number) => Boolean(pad.buttons[idx]?.pressed);
    const axisX = pad.axes[0] ?? 0;
    const axisY = pad.axes[1] ?? 0;
    const deadzone = 0.55;

    // Select + Start: salir del juego y volver al Hub.
    if (btn(8) && btn(9)) return 'EXIT';

    if (btn(12) || axisY < -deadzone) return 'UP';
    if (btn(13) || axisY > deadzone) return 'DOWN';
    if (btn(14) || axisX < -deadzone) return 'LEFT';
    if (btn(15) || axisX > deadzone) return 'RIGHT';
    // Solo A inicia el juego: Start por sí solo ya no lanza nada al conectar el mando.
    if (btn(0)) return 'CONFIRM'; // A / Cruz
    if (btn(1)) return 'BACK';    // B / Círculo
    if (btn(3)) return 'DELETE';  // Y / Triángulo
    return null;
  }

  private stopPolling(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  ngOnDestroy(): void {
    if (isPlatformBrowser(this.platformId)) {
      window.removeEventListener('gamepadconnected', this.onConnect);
      window.removeEventListener('gamepaddisconnected', this.onDisconnect);
      this.stopPolling();
    }
  }
}
