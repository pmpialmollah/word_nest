import { addWord, getAccountData, importNotes, importRecords } from './src/repositories/vocabularyRepository.js';
import { initFirebase } from './src/firebase/config.js';
import { onAuthStateChanged, signOutUser } from './src/firebase/auth.js';
import { showAuthenticatedShell, showUnauthorized } from './src/app/app.js';
import { createNoteImportPlan } from './src/features/notes/mergePlan.js';

let currentUser = null;
let backupData = {groups:[], activeGroup:'', words:[], notes:[]};
let pendingImport = null;
initFirebase();

function toArray(value){
  if(!value) return [];
  return Array.isArray(value) ? value : Object.keys(value).map(key => Object.assign({}, value[key], {id:value[key].id || key})).filter(Boolean);
}
function updateSummary(snapshot){
  backupData = {groups:toArray(snapshot && snapshot.groups), activeGroup:snapshot && snapshot.activeGroup || '', words:toArray(snapshot && snapshot.words), notes:toArray(snapshot && snapshot.notes)};
  document.getElementById('wordTotal').textContent = backupData.words.length;
  document.getElementById('noteTotal').textContent = backupData.notes.length;
}
function showToast(message){
  const toast = document.getElementById('toast'); toast.textContent = message; toast.classList.add('show');
  clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove('show'), 2400);
}
function exportData(){
  const blob = new Blob([JSON.stringify(backupData, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url;
  link.download = 'word-nest-backup-' + new Date().toISOString().slice(0,10) + '.json'; link.click(); URL.revokeObjectURL(url); showToast('Backup is downloaded');
}
async function importData(file){
  try{
    const imported = JSON.parse(await file.text());
    if(!imported.groups || !imported.words || !currentUser){ showToast('The file is not in correct format'); return; }
    const existing = await getAccountData(currentUser.uid) || {};
    const existingGroups = toArray(existing.groups);
    const existingWords = toArray(existing.words);
    const groupIdMap = {};
    const groupsToAdd = [];
    toArray(imported.groups).forEach(group => {
      const match = existingGroups.find(item => (item.name || '').trim().toLowerCase() === (group.name || '').trim().toLowerCase());
      if(match) groupIdMap[group.id] = match.id;
      else {
        const id = crypto.randomUUID ? crypto.randomUUID() : 'g_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        groupIdMap[group.id] = id;
        groupsToAdd.push({id, name:group.name || 'Imported group'});
      }
    });
    const wordsToAdd = [];
    const conflicts = [];
    toArray(imported.words).forEach(word => {
      const groupId = groupIdMap[word.groupId];
      if(!groupId) return;
      const match = existingWords.find(item => item.groupId === groupId && (item.text || '').trim().toLowerCase() === (word.text || '').trim().toLowerCase());
      if(match) conflicts.push({imported:word, existing:match, groupId});
      else wordsToAdd.push({id:crypto.randomUUID ? crypto.randomUUID() : 'w_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), text:word.text || '', meaning:word.meaning || '', example:word.example || '', groupId, revealed:false, read:Boolean(word.read)});
    });
    const notePlan = createNoteImportPlan(toArray(imported.notes), toArray(existing.notes));
    pendingImport = {groupsToAdd, wordsToAdd, conflicts, notes:notePlan.notesToAdd, noteConflicts:notePlan.conflicts};
    if(conflicts.length || notePlan.conflicts.length) {
      renderSettingsMerge();
      document.getElementById('settingsMergeBackdrop').classList.add('show');
    } else applySettingsImport([]);
  }catch(error){ console.error(error); showToast('Import failed'); }
}
function renderSettingsMerge(){
  const list = document.getElementById('settingsMergeList');
  list.innerHTML = '';
  if(pendingImport.conflicts.length){
    appendMergeSectionTitle(list, 'Words');
  }
  pendingImport.conflicts.forEach((conflict, index) => {
    const item = document.createElement('div');
    item.className = 'merge-item';
    item.innerHTML = '<p class="mi-word">' + escapeHtml(conflict.imported.text) + '</p>' +
      '<div class="merge-options">' +
      '<label><input type="radio" name="settings_merge_' + index + '" value="keep_existing" checked> keep existing <span class="mi-meaning">' + escapeHtml(conflict.existing.meaning || 'no meaning') + '</span></label>' +
      '<label><input type="radio" name="settings_merge_' + index + '" value="keep_new"> replace with imported <span class="mi-meaning">' + escapeHtml(conflict.imported.meaning || 'no meaning') + '</span></label>' +
      '<label><input type="radio" name="settings_merge_' + index + '" value="keep_both"> keep both</label>' +
      '</div>';
    list.appendChild(item);
  });
  if(pendingImport.noteConflicts.length){
    appendMergeSectionTitle(list, 'Notes');
  }
  pendingImport.noteConflicts.forEach((conflict, index) => {
    const item = document.createElement('div');
    item.className = 'merge-item';
    item.innerHTML = '<p class="mi-word">' + escapeHtml(conflict.imported.title || 'Untitled note') + '</p>' +
      '<div class="merge-options">' +
      '<label><input type="radio" name="settings_note_merge_' + index + '" value="keep_existing" checked> keep existing</label>' +
      '<label><input type="radio" name="settings_note_merge_' + index + '" value="keep_new"> replace with imported</label>' +
      '<label><input type="radio" name="settings_note_merge_' + index + '" value="keep_both"> keep both</label>' +
      '</div>';
    list.appendChild(item);
  });
}
function appendMergeSectionTitle(container, title){
  const heading = document.createElement('h4');
  heading.className = 'merge-section-title';
  heading.textContent = title;
  container.appendChild(heading);
}
function escapeHtml(value){
  const element = document.createElement('div');
  element.textContent = value == null ? '' : value;
  return element.innerHTML;
}
async function applySettingsImport(choices){
  if(!pendingImport || !currentUser) return;
  const {groupsToAdd, wordsToAdd, conflicts, notes, noteConflicts} = pendingImport;
  try{
    const notesToAdd = notes.map(note => {
      const id = crypto.randomUUID ? crypto.randomUUID() : 'n_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      return Object.assign({}, note, {id});
    });
    await importRecords(currentUser.uid, { groups:groupsToAdd, words:wordsToAdd, notes:notesToAdd });
    for(const [index, conflict] of conflicts.entries()) {
      const choice = choices[index] || 'keep_existing';
      if(choice === 'keep_new') await addWord(currentUser.uid, Object.assign({}, conflict.imported, {id:conflict.existing.id, groupId:conflict.groupId}));
      if(choice === 'keep_both') {
        const id = crypto.randomUUID ? crypto.randomUUID() : 'w_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        await addWord(currentUser.uid, Object.assign({}, conflict.imported, {id, groupId:conflict.groupId}));
      }
    }
    const noteChoices = noteConflicts.map((_, index) => document.querySelector('input[name="settings_note_merge_' + index + '"]:checked')?.value || 'keep_existing');
    await importNotes(currentUser.uid, { notesToAdd:[], conflicts:noteConflicts }, noteChoices);
    pendingImport = null;
    document.getElementById('settingsMergeBackdrop').classList.remove('show');
    showToast('All data imported without removing existing data');
  }catch(error){ console.error(error); showToast('Import failed'); }
}
function closeLogout(){ document.getElementById('logoutBackdrop').classList.remove('show'); }

document.getElementById('exportBtn').onclick = exportData;
document.getElementById('importBtn').onclick = () => document.getElementById('importFile').click();
document.getElementById('importFile').onchange = event => { const file = event.target.files[0]; if(file) importData(file); event.target.value = ''; };
document.getElementById('cancelSettingsMergeBtn').onclick = () => { pendingImport = null; document.getElementById('settingsMergeBackdrop').classList.remove('show'); };
document.getElementById('confirmSettingsMergeBtn').onclick = () => {
  if(!pendingImport) return;
  const choices = pendingImport.conflicts.map((_, index) => document.querySelector('input[name="settings_merge_' + index + '"]:checked')?.value || 'keep_existing');
  applySettingsImport(choices);
};
document.getElementById('logoutBtn').onclick = () => document.getElementById('logoutBackdrop').classList.add('show');
document.getElementById('cancelLogoutBtn').onclick = closeLogout;
document.getElementById('logoutBackdrop').onclick = event => { if(event.target.id === 'logoutBackdrop') closeLogout(); };
document.getElementById('confirmLogoutBtn').onclick = async () => { try{ await signOutUser(); }catch(error){ console.error(error); showToast('Log out failed'); } };

onAuthStateChanged(async user => {
  if(!user){ showUnauthorized(); window.location.replace('home.html'); return; }
  currentUser = user;
  showAuthenticatedShell(user);
  document.getElementById('settingsEmail').textContent = user.email || 'Account';
  getAccountData(user.uid).then(snapshot => updateSummary(snapshot)).catch(error => {
    console.error(error);
    showToast('Could not load account data');
  });
});
