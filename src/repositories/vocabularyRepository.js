import {
  getUserOnce,
  listenToUser,
  removeUserChild,
  setUserChild,
  stopListeningToUser,
  updateUserChild
} from '../firebase/database.js';
import { normalizeVocabularySnapshot } from '../features/vocabulary/model.js';

export {
  getUserOnce,
  listenToUser,
  removeUserChild,
  setUserChild,
  stopListeningToUser,
  updateUserChild
};

export async function getVocabulary(uid) {
  return normalizeVocabularySnapshot(await getUserOnce(uid));
}

export function getAccountData(uid) {
  return getUserOnce(uid);
}

export function subscribeToVocabulary(uid, callback) {
  return listenToUser(uid, snapshot => callback(normalizeVocabularySnapshot(snapshot)));
}

export function subscribeToNotes(uid, callback) {
  return listenToUser(uid, callback);
}

export function addWord(uid, word) {
  return setUserChild(uid, `words/${word.id}`, word);
}

export function updateWord(uid, wordId, changes) {
  return updateUserChild(uid, `words/${wordId}`, changes);
}

export function deleteWord(uid, wordId) {
  return removeUserChild(uid, `words/${wordId}`);
}

export function addNote(uid, note) {
  return setUserChild(uid, `notes/${note.id}`, note);
}

export function updateNote(uid, noteId, changes) {
  return updateUserChild(uid, `notes/${noteId}`, changes);
}

export function deleteNote(uid, noteId) {
  return removeUserChild(uid, `notes/${noteId}`);
}

export function addGroup(uid, group) {
  return setUserChild(uid, `groups/${group.id}`, group);
}

export function renameGroup(uid, groupId, name) {
  return updateUserChild(uid, `groups/${groupId}`, { name });
}

export function setActiveGroup(uid, groupId) {
  return setUserChild(uid, 'activeGroup', groupId);
}

export async function deleteGroup(uid, groupId) {
  const current = await getUserOnce(uid);
  const words = Object.values((current && current.words) || {});
  await Promise.all(words
    .filter(word => word && word.groupId === groupId)
    .map(word => deleteWord(uid, word.id)));
  await removeUserChild(uid, `groups/${groupId}`);

  const after = await getUserOnce(uid);
  const groups = Object.values((after && after.groups) || {});
  if (!groups.length) {
    const fallback = { id: 'g_' + Date.now().toString(36), name: 'General' };
    await addGroup(uid, fallback);
    await setActiveGroup(uid, fallback.id);
  } else {
    await setActiveGroup(uid, after.activeGroup && groups.some(group => group.id === after.activeGroup)
      ? after.activeGroup
      : groups[0].id);
  }
}

export async function importVocabulary(uid, plan, choices) {
  for (const group of plan.groupsToAdd) await addGroup(uid, group);
  for (const word of plan.wordsToAdd) await addWord(uid, word);
  for (const note of plan.notesToAdd) await setUserChild(uid, `notes/${note.id}`, note);

  for (const [index, conflict] of plan.conflicts.entries()) {
    const choice = choices[index] || 'keep_existing';
    if (choice === 'keep_new') {
      await addWord(uid, { ...conflict.imported, id: conflict.existing.id, groupId: conflict.groupId });
    } else if (choice === 'keep_both') {
      await addWord(uid, {
        ...conflict.imported,
        id: 'w_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
        groupId: conflict.groupId,
        revealed: false
      });
    }
  }
}

export async function importRecords(uid, { groups = [], words = [], notes = [], activeGroup = '' }) {
  for (const group of groups) await addGroup(uid, group);
  for (const word of words) await addWord(uid, word);
  for (const note of notes) await addNote(uid, note);
  if (activeGroup) await setActiveGroup(uid, activeGroup);
}

export async function importNotes(uid, plan, choices) {
  for (const note of plan.notesToAdd) await addNote(uid, note);
  for (const [index, conflict] of plan.conflicts.entries()) {
    const choice = choices[index] || 'keep_existing';
    if (choice === 'keep_new') {
      await addNote(uid, { ...conflict.imported, id: conflict.existing.id });
    } else if (choice === 'keep_both') {
      await addNote(uid, { ...conflict.imported, id: 'n_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8) });
    }
  }
}