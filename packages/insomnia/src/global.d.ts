/// <reference types="vite/client" />
import type { MainBridgeAPI } from './main/ipc/main';

declare global {
  interface Window {
    main: MainBridgeAPI;
    dialog: Pick<Electron.Dialog, 'showOpenDialog' | 'showSaveDialog'>;
    app: Pick<Electron.App, 'getPath' | 'getAppPath'>;
    shell: Pick<Electron.Shell, 'showItemInFolder'>;
    // sync over IPC, though Electron's own clipboard is async since 44
    clipboard: { readText(): string; writeText(text: string): void; clear(): void };
  }
}

declare const __DEV__: boolean;

declare namespace NodeJS {
  interface Global {
    __DEV__: boolean;
    /** this is required by codemirror/addon/lint/yaml-lint */
    jsyaml: any;
  }
}
