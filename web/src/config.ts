/**
 * Конфиг приложения. Порядок приоритета:
 * 1) window.__ENV__ из /env.js (подставляется на старте Docker-контейнера);
 * 2) переменные Vite (VITE_*) на этапе сборки/дева;
 * 3) значения по умолчанию.
 */
function pick(runtime: string | undefined, buildTime: string | undefined, fallback: string): string {
  if (runtime && runtime.trim() !== '') return runtime;
  if (buildTime && buildTime.trim() !== '') return buildTime;
  return fallback;
}

const runtime = (typeof window !== 'undefined' && window.__ENV__) || {};

export const config = {
  apiUrl: pick(runtime.API_URL, import.meta.env.VITE_API_URL, 'http://localhost:8080/api/v1').replace(
    /\/$/,
    '',
  ),
  agentUrl: pick(runtime.AGENT_URL, import.meta.env.VITE_AGENT_URL, 'http://localhost:8081/api/v1').replace(
    /\/$/,
    '',
  ),
  useMocks: pick(runtime.USE_MOCKS, import.meta.env.VITE_USE_MOCKS, 'false') === 'true',
  /** Таймаут обычного REST-запроса. */
  requestTimeoutMs: 15_000,
  /** Если за это время в SSE-стриме не пришло ни одного события — считаем, что агент завис. */
  streamIdleTimeoutMs: 60_000,
};
