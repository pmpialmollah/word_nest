import { setAppState } from './state.js';

export function showAuthenticatedShell(user) {
  setAppState({ user, authStatus: 'authenticated', dataStatus: 'loading' });
  document.documentElement.classList.remove('auth-pending');
}

export function finishDataLoading() {
  setAppState({ dataStatus: 'ready' });
  document.documentElement.classList.remove('data-loading');
}

export function showUnauthorized() {
  setAppState({ user: null, authStatus: 'unauthorized', dataStatus: 'idle' });
}