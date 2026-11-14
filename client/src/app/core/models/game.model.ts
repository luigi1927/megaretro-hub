export interface RetroGame {
  id: string;
  title: string;
  system: string;
  year: number;
  sizeMB: number;
  emulator: string;
  core: string;
  coverUrl: string;
  executableFile: string;
  installed: boolean;
  downloading?: boolean;
  extracting?: boolean;
  progress?: number;
}

export interface SystemRequirement {
  id: string;
  label: string;
  emulator: string;
  ready: boolean;
  note: string;
}

export interface SystemStatus {
  packaged: boolean;
  dataDir: string;
  gamesDir: string;
  downloadsDir: string;
  emulators: {
    retroarch: { installed: boolean; dir: string; missingCores: string[] };
    pcsx2: { installed: boolean; dir: string; configPrepared: boolean };
    dolphin: { installed: boolean; dir: string; portable: boolean };
  };
  bios: {
    ps1: { found: boolean; name: string | null; dir: string };
    ps2: { found: boolean; files: string[]; dir: string };
  };
  systems: SystemRequirement[];
}

export interface LauncherEvent {
  type:
    | 'CONNECTED'
    | 'WATCHER_STATUS'
    | 'IMPORT_STARTED'
    | 'GAME_IMPORTED'
    | 'DOWNLOAD_START'
    | 'DOWNLOAD_PROGRESS'
    | 'EXTRACTING'
    | 'DOWNLOAD_COMPLETE'
    | 'DOWNLOAD_ERROR'
    | 'GAME_DELETED'
    | 'GAME_STARTED'
    | 'GAME_CLOSED'
    | 'GAME_ERROR'
    | 'ERROR_TOAST';
  gameId?: string;
  game?: RetroGame;
  active?: boolean;
  system?: string;
  progress?: number;
  title?: string;
  message?: string;
}