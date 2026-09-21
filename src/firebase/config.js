import { getApps, initializeApp } from 'firebase/app';

const firebaseConfig = {
  apiKey: 'AIzaSyCTkuG59Usw2Q_QaPIb8auq7bAulyGrFAA',
  authDomain: 'vocabulary-app-e52fe.firebaseapp.com',
  databaseURL: 'https://vocabulary-app-e52fe-default-rtdb.firebaseio.com/',
  projectId: 'vocabulary-app-e52fe',
  appId: '1:571240382911:web:745d220516d08b8114a10a'
};

export const firebaseApp = getApps()[0] || initializeApp(firebaseConfig);

export function initFirebase() {
  return firebaseApp;
}