import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import './tokens.css';
import './kitchen.css';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
