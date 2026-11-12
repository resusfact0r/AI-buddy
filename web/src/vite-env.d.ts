/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_AGENT_URL?: string;
  readonly VITE_USE_MOCKS?: string;
}

interface Window {
  __ENV__?: Partial<Record<'API_URL' | 'AGENT_URL' | 'USE_MOCKS', string>>;
}
