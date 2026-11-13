import { Component, inject } from '@angular/core';
import { KeyValuePipe } from '@angular/common';
import { LauncherService } from '../../../core/services/launcher.service';

@Component({
  selector: 'app-download-wizard',
  standalone: true,
  imports: [KeyValuePipe],
  template: `
    @if (launcher.showGetGamesModal()) {
      <div class="modal-backdrop" (click)="launcher.showGetGamesModal.set(false)">
        <div class="wizard-modal" (click)="$event.stopPropagation()">
          <div class="wizard-header">
            <h2>¿Qué consola quieres jugar hoy?</h2>
            <button class="btn-close" (click)="launcher.showGetGamesModal.set(false)">✕</button>
          </div>
          <p>
            Elige una consola para abrir su repositorio web. En cuanto descargues el archivo
            (<code>.zip</code>, <code>.chd</code>, <code>.iso</code>), el radar lo extraerá e instalará solo.
          </p>

          <div class="console-picker">
            @for (entry of launcher.webSources() | keyvalue; track entry.key) {
              <button
                class="console-tile"
                (click)="launcher.openWebPortalAndWatch(entry.key, entry.value)">
                <span class="sys-name">{{ entry.key }}</span>
                <span class="sys-action">Ir a descargar ↗</span>
              </button>
            }
          </div>

          <div class="custom-url-box">
            <select #sysSelect>
              <option value="PS1">PS1</option>
              <option value="SNES">SNES</option>
              <option value="GBA">GBA</option>
              <option value="N64">N64</option>
              <option value="PSP">PSP</option>
              <option value="PS2">PS2</option>
            </select>
            <input
              #urlInput
              type="url"
              placeholder="O pega aquí una URL HTTPS donde tengas tus ROMs..." />
            <button (click)="launcher.openWebPortalAndWatch(sysSelect.value, urlInput.value)">
              Abrir y Vigilar
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(5, 8, 15, 0.85);
      backdrop-filter: blur(6px);
      display: grid;
      place-items: center;
      z-index: 60;
    }
    .wizard-modal {
      background: #111827;
      border: 1px solid rgba(56, 189, 248, 0.25);
      border-radius: 20px;
      padding: 32px;
      max-width: 640px;
      width: 92%;
      box-shadow: 0 25px 50px rgba(0, 0, 0, 0.6);
    }
    .wizard-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .wizard-header h2 {
      margin: 0;
      font-size: 1.4rem;
    }
    .btn-close {
      background: rgba(255, 255, 255, 0.08);
      border: none;
      color: #94a3b8;
      width: 32px;
      height: 32px;
      border-radius: 8px;
      cursor: pointer;
    }
    .wizard-modal p {
      color: #94a3b8;
      margin: 12px 0 24px;
      line-height: 1.5;
    }
    .console-picker {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      margin-bottom: 24px;
    }
    .console-tile {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 16px;
      color: #fff;
      cursor: pointer;
      text-align: left;
      transition: 0.2s;
    }
    .console-tile:hover {
      border-color: #38bdf8;
      background: rgba(56, 189, 248, 0.12);
      transform: translateY(-2px);
    }
    .sys-name {
      display: block;
      font-size: 1.15rem;
      font-weight: 800;
    }
    .sys-action {
      font-size: 0.78rem;
      color: #38bdf8;
    }
    .custom-url-box {
      display: flex;
      gap: 8px;
    }
    .custom-url-box select,
    .custom-url-box input {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 10px;
      padding: 10px 12px;
      color: #fff;
      outline: none;
    }
    .custom-url-box select option {
      background: #111827;
    }
    .custom-url-box input {
      flex: 1;
    }
    .custom-url-box button {
      background: #38bdf8;
      color: #090c12;
      border: none;
      padding: 10px 16px;
      border-radius: 10px;
      font-weight: 700;
      cursor: pointer;
    }
  `]
})
export class DownloadWizardComponent {
  readonly launcher = inject(LauncherService);
}