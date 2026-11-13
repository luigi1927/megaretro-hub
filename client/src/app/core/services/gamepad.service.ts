import { Injectable, signal, OnDestroy, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export type GamepadAction =
  | 'UP'
  | 'DOWN'
  | 'LEFT'
  | 'RIGHT'
  | 'CONFIRM'
  | 'DELETE'
  | 'PREV_TAB'
  | 'NEXT_TAB';

@Injectable({ providedIn: 'root' })
export class GamepadService implements OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  readonly connectedGamepad = signal<string | null>(null);
  private rafId: number | null = null;
  private lastInputTime = 0;
  private listeners: Array<(action: GamepadAction) => void> = [];

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      window.addEventListener('gamepadconnected', (e) => {
        this.connectedGamepad.set(e.gamepad.id);
      });
      window.addEventListener('gamepaddisconnected', () => {
        this.connectedGamepad.set(null);
      });
      this.startPolling();
    }
  }

  onAction(callback: (action: GamepadAction) => void): void {
    this.listeners.push(callback);
  }

  private emit(action: GamepadAction): void {
    for (const fn of this.listeners) fn(action);
  }

  private startPolling(): void {
    const loop = (timestamp: number) => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const pad = pads[0];

      if (pad && timestamp - this.lastInputTime > 180) {
        const axisX = pad.axes[0] ?? 0;
        const axisY = pad.axes[1] ?? 0;

        if (pad.buttons[12]?.pressed || axisY < -0.5) {
          this.trigger('UP', timestamp);
        } else if (pad.buttons[13]?.pressed || axisY > 0.5) {
          this.trigger('DOWN', timestamp);
        } else if (pad.buttons[14]?.pressed || axisX < -0.5) {
          this.trigger('LEFT', timestamp);
        } else if (pad.buttons[15]?.pressed || axisX > 0.5) {
          this.trigger('RIGHT', timestamp);
        } else if (pad.buttons[0]?.pressed) {
          this.trigger('CONFIRM', timestamp);
        } else if (pad.buttons[2]?.pressed) {
          this.trigger('DELETE', timestamp);
        } else if (pad.buttons[4]?.pressed) {
          this.trigger('PREV_TAB', timestamp);
        } else if (pad.buttons[5]?.pressed) {
          this.trigger('NEXT_TAB', timestamp);
        }
      }

      this.rafId = requestAnimationFrame(loop);
    };

    this.rafId = requestAnimationFrame(loop);
  }

  private trigger(action: GamepadAction, timestamp: number): void {
    this.lastInputTime = timestamp;
    this.emit(action);
  }

  ngOnDestroy(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
  }
}
