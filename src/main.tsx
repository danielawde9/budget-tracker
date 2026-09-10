import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.js';
import { takeHouseholdInvitation } from './features/household/invitation-fragment.js';
import './styles.css';

const householdInvitationToken = takeHouseholdInvitation(window.location, window.history);
const root = document.querySelector('#root');

if (!root) {
  throw new Error('Application root is missing');
}

createRoot(root).render(
  <StrictMode>
    <App initialHouseholdInvitationToken={householdInvitationToken} />
  </StrictMode>,
);
