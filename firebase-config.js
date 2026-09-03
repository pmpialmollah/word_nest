// Firebase initialization and helper wrappers (browser module)
// EDIT: replace the `firebaseConfig` object below with your Firebase project's config.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged as fbOnAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as fbSignOut
} from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js';
import {
  getDatabase,
  ref,
  set,
  update,
  remove,
  get,
  onValue,
  off
} from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js';

export let firebaseApp = null;
export let auth = null;
export let db = null;

// Placeholder config — replace with your actual Firebase config
const firebaseConfig = {
  apiKey: 'AIzaSyCTkuG59Usw2Q_QaPIb8auq7bAulyGrFAA',
  authDomain: 'vocabulary-app-e52fe.firebaseapp.com',
  databaseURL: 'https://vocabulary-app-e52fe-default-rtdb.firebaseio.com/',
  projectId: 'vocabulary-app-e52fe',
  appId: '1:571240382911:web:745d220516d08b8114a10a'
};

export function initFirebase(cfg = null){
  const conf = cfg || firebaseConfig;
  if(!conf || !conf.apiKey || conf.apiKey.startsWith('<')){
    console.warn('Firebase config is missing or placeholder values are present. Fill firebase-config.js with your project config.');
  }
  firebaseApp = initializeApp(conf);
  auth = getAuth(firebaseApp);
  db = getDatabase(firebaseApp);
}

export function onAuthStateChanged(cb){
  if(!auth) return () => {};
  return fbOnAuthStateChanged(auth, cb);
}

export async function signUpWithEmail(email, password){
  if(!auth) throw new Error('Firebase not initialized');
  return createUserWithEmailAndPassword(auth, email, password);
}

export async function signInWithEmail(email, password){
  if(!auth) throw new Error('Firebase not initialized');
  return signInWithEmailAndPassword(auth, email, password);
}

export async function signOutUser(){
  if(!auth) return;
  return fbSignOut(auth);
}

// Realtime DB helpers
export function userRef(uid){
  if(!db) throw new Error('Firebase DB not initialized');
  return ref(db, 'users/' + uid);
}

export function userChildRef(uid, childPath){
  if(!db) throw new Error('Firebase DB not initialized');
  return ref(db, `users/${uid}/${childPath}`);
}

export async function getUserOnce(uid){
  const r = userRef(uid);
  const snap = await get(r);
  return snap.exists() ? snap.val() : null;
}

export function listenToUser(uid, cb){
  const r = userRef(uid);
  const handler = onValue(r, snapshot => cb(snapshot.val()));
  return handler;
}

export function stopListeningToUser(uid){
  const r = userRef(uid);
  off(r);
}

export async function setUserChild(uid, childPath, value){
  const r = userChildRef(uid, childPath);
  return set(r, value);
}

export async function updateUserChild(uid, childPath, value){
  const r = userChildRef(uid, childPath);
  return update(r, value);
}

export async function removeUserChild(uid, childPath){
  const r = userChildRef(uid, childPath);
  return remove(r);
}
