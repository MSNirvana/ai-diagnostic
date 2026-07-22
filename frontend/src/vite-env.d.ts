/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_GGOO_API_BASE?: string;
  readonly VITE_GGOO_WEB_BASE?: string;
  readonly VITE_DEV_AUTH_BYPASS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
