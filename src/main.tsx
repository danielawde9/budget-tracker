import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './control-room.css';

const root = document.querySelector('#root');

if (!root) {
  throw new Error('Application root is missing');
}

createRoot(root).render(
  <StrictMode>
    <main className="cr-main">Budget v2 is being rebuilt on this branch.</main>
  </StrictMode>,
);
