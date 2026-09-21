export const appState = {
  user: null,
  authStatus: 'loading',
  dataStatus: 'loading',
  data: null,
  vocabulary: [],
  groups: [],
  currentView: 'dashboard'
};

export function setAppState(changes) {
  Object.assign(appState, changes);
  return appState;
}