import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/manrope';
import './index.css';
import { config } from './config';
import { App } from './app/App';

async function bootstrap() {
  if (config.useMocks) {
    const { startMocks } = await import('./mocks/browser');
    await startMocks();
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
