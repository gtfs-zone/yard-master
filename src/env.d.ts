/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Overrides `CONFIG.RT_BASE`, so a production build can point at a local feed server. */
  readonly VITE_RT_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __APP_VERSION__: string;
