declare global {
  interface Window {
    __glMrPaletteRun?: (id: string) => void;
    __glMrActionsLoaded?: boolean;
    __glMrPaletteActions?: { id: string; label: string; icon: string }[];
    webkitAudioContext?: typeof AudioContext;
  }
}
export {};
