/**
 * TypeScript definitions for Electron API exposed via preload
 */

interface ElectronAPI {
  isElectron: boolean;
  getPlatform: () => Promise<{
    platform: string;
    isElectron: boolean;
    isWindows: boolean;
    isMac: boolean;
    isLinux: boolean;
  }>;
  getVersion: () => Promise<string>;

  persistSet: (key: string, value: string) => void;
  persistRemove: (key: string) => void;
  persistAll: (obj: Record<string, string>) => void;

  youtubeOpen: (opts: { videoId: string; isPlaylist?: boolean }) => Promise<{ success: boolean }>;
  youtubeBounds: (bounds: { x: number; y: number; width: number; height: number; visible?: boolean }) => void;
  youtubeSetVisible: (visible: boolean) => void;
  youtubeClose: () => void;
  youtubeCommand: (cmd: "play" | "pause") => Promise<{ success: boolean; error?: string }>;
  onYoutubeEnded: (cb: () => void) => () => void;
  onYoutubeState: (cb: (playing: boolean) => void) => () => void;

  printer: {
    list: () => Promise<{
      success: boolean;
      ports?: Array<{
        path: string;
        manufacturer?: string;
        serialNumber?: string;
        vendorId?: string;
        productId?: string;
        kind?: "serial" | "windows";
        label?: string;
      }>;
      error?: string;
    }>;
    print: (portPath: string, escPosHex: string) => Promise<{
      success: boolean;
      error?: string;
    }>;
    printAndOpenDrawer: (portPath: string, escPosHex: string, pulseHex?: string) => Promise<{
      success: boolean;
      opened?: boolean;
      error?: string;
    }>;
  };

  drawer: {
    open: (portPath: string, pulseHex?: string) => Promise<{
      success: boolean;
      opened?: boolean;
      error?: string;
    }>;
  };

  installUpdate: (url: string) => Promise<{ success: boolean; error?: string }>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
