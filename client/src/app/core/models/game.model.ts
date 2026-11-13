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