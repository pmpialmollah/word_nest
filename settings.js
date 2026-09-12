import { initFirebase, onAuthStateChanged, listenToUser, stopListeningToUser, signOutUser, setUserChild } from './firebase-config.js';

let currentUser = null;
let listenerUid = null;
let backupData = {groups:[], activeGroup:'', words:[], notes:[]};
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
    if(!window.confirm('Import all words, groups, and sticky notes into this account?')) return;
    for(const group of toArray(imported.groups)) await setUserChild(currentUser.uid, 'groups/' + group.id, group);
    for(const word of toArray(imported.words)) await setUserChild(currentUser.uid, 'words/' + word.id, word);
    for(const note of toArray(imported.notes)) await setUserChild(currentUser.uid, 'notes/' + note.id, note);
    if(imported.activeGroup) await setUserChild(currentUser.uid, 'activeGroup', imported.activeGroup);
    showToast('All data imported');
  }catch(error){ console.error(error); showToast('Import failed'); }
}
function closeLogout(){ document.getElementById('logoutBackdrop').classList.remove('show'); }

document.getElementById('exportBtn').onclick = exportData;
document.getElementById('importBtn').onclick = () => document.getElementById('importFile').click();
document.getElementById('importFile').onchange = event => { const file = event.target.files[0]; if(file) importData(file); event.target.value = ''; };
document.getElementById('logoutBtn').onclick = () => document.getElementById('logoutBackdrop').classList.add('show');
document.getElementById('cancelLogoutBtn').onclick = closeLogout;
document.getElementById('logoutBackdrop').onclick = event => { if(event.target.id === 'logoutBackdrop') closeLogout(); };
document.getElementById('confirmLogoutBtn').onclick = async () => { try{ await signOutUser(); }catch(error){ console.error(error); showToast('Log out failed'); } };

onAuthStateChanged(async user => {
  if(!user){ window.location.replace('home.html'); return; }
  currentUser = user;
  document.getElementById('settingsEmail').textContent = user.email || 'Account';
  listenerUid = user.uid;
  listenToUser(user.uid, snapshot => updateSummary(snapshot));
  document.documentElement.classList.remove('auth-pending');
});
window.addEventListener('beforeunload', () => { if(listenerUid) stopListeningToUser(listenerUid); });
