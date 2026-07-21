/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Full origin of a separately-deployed API server, e.g.
   * "https://pulsenet-api.up.railway.app". Leave unset when this app and
   * the API share an origin behind one reverse proxy — requests then stay
   * relative ("/api/...").
   */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
