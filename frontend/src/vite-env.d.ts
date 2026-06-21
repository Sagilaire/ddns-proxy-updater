/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Custom events emitted by the API client
interface WindowEventMap {
  'ddns:unauthorized': CustomEvent<undefined>;
}
