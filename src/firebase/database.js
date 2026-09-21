import { get, getDatabase, off, onValue, ref, remove, set, update } from 'firebase/database';
import { firebaseApp } from './config.js';

const db = getDatabase(firebaseApp);

export function userRef(uid) {
  return ref(db, `users/${uid}`);
}

export function userChildRef(uid, childPath) {
  return ref(db, `users/${uid}/${childPath}`);
}

export async function getUserOnce(uid) {
  const snapshot = await get(userRef(uid));
  return snapshot.exists() ? snapshot.val() : null;
}

export function listenToUser(uid, callback) {
  return onValue(userRef(uid), snapshot => callback(snapshot.val()));
}

export function stopListeningToUser(uid) {
  off(userRef(uid));
}

export const setUserChild = (uid, childPath, value) => set(userChildRef(uid, childPath), value);
export const updateUserChild = (uid, childPath, value) => update(userChildRef(uid, childPath), value);
export const removeUserChild = (uid, childPath) => remove(userChildRef(uid, childPath));