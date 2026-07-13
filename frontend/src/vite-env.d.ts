/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_GGOO_API_BASE?: string;
  readonly VITE_GGOO_WEB_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
