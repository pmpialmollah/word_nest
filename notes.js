import {
  initFirebase,
  onAuthStateChanged,
  signUpWithEmail,
  signInWithEmail,
  signOutUser,
  getUserOnce,
  listenToUser,
  stopListeningToUser,
  setUserChild,
  updateUserChild,
  removeUserChild
} from './firebase-config.js';

const STORAGE_KEY = 'wordnest_data_v1';
const NOTE_COLORS = ['yellow', 'pink', 'blue', 'green'];
let currentUser = null;
let currentListenerUid = null;
let activeFilter = 'all';
let selectedColor = 'yellow';
let editColor = 'yellow';
let editingNoteId = null;
let deletingNoteId = null;
let data = loadData();

initFirebase();

function loadData(){
  return { groups:[{id:'default', name:'general'}], activeGroup:'default', words:[], notes:[] };
}
function saveData(){
  // All user data is persisted in Firebase only.
}
function requireAuth(){
  if(currentUser) return true;
  showAuthModal('login');
  return false;
}
function noteId(){
  return 'n_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8);
}
function showToast(message){
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2200);
}
function normalizeNotes(snapshot){
  const notes = [];
  const cloudNotes = snapshot && snapshot.notes ? snapshot.notes : {};
  Object.keys(cloudNotes).forEach(key => {
    if(cloudNotes[key]) notes.push(Object.assign({}, cloudNotes[key], {id:cloudNotes[key].id || key}));
  });
  return notes;
}
async function startUserSync(uid){
  if(currentListenerUid === uid) return;
  if(currentListenerUid) stopListeningToUser(currentListenerUid);
  currentListenerUid = uid;
  const cloud = await getUserOnce(uid);
  const localNotes = data.notes || [];
  if(!cloud){
    if(localNotes.length) await setUserChild(uid, 'notes', Object.fromEntries(localNotes.map(note => [note.id, note])));
  }else{
    const cloudNotes = cloud.notes || {};
    const missing = {};
    localNotes.forEach(note => { if(!cloudNotes[note.id]) missing[note.id] = note; });
    if(Object.keys(missing).length) await setUserChild(uid, 'notes', Object.assign({}, cloudNotes, missing));
  }
  listenToUser(uid, snapshot => {
    data.notes = normalizeNotes(snapshot);
    saveData();
    renderNotes();
  });
}
function stopUserSync(){
  if(currentListenerUid) stopListeningToUser(currentListenerUid);
  currentListenerUid = null;
}
function persistLocal(){ saveData(); renderNotes(); }
function visibleNotes(){
  const notes = data.notes || [];
  if(activeFilter === 'read') return notes.filter(note => note.read);
  if(activeFilter === 'unread') return notes.filter(note => !note.read);
  return notes;
}
function renderNotes(){
  const grid = document.getElementById('notesGrid');
  const notes = visibleNotes();
  document.getElementById('noteCount').textContent = (data.notes || []).length + ' notes';
  grid.innerHTML = '';
  if(!notes.length){
    grid.innerHTML = '<div class="notes-empty"><strong>No notes here yet.</strong><span>Add a little thought above.</span></div>';
    return;
  }
  notes.forEach((note, index) => {
    const card = document.createElement('article');
    card.className = 'sticky-note ' + (NOTE_COLORS.includes(note.color) ? note.color : 'yellow') + (note.read ? ' read' : '');
    card.style.setProperty('--note-tilt', index % 3 === 1 ? '-1.1deg' : index % 3 === 2 ? '0.8deg' : '0deg');
    const pin = document.createElement('span'); pin.className = 'note-pin'; pin.setAttribute('aria-hidden', 'true');
    const title = document.createElement('h2'); title.textContent = note.title || 'Untitled note';
    const text = document.createElement('p'); text.textContent = note.text;
    const date = document.createElement('time'); date.textContent = note.updatedAt ? new Date(note.updatedAt).toLocaleDateString() : '';
    const actions = document.createElement('div'); actions.className = 'note-actions';
    const readBtn = makeAction(note.read ? 'Mark unread' : 'Mark read', note.read ? 'Read' : 'Unread', () => toggleRead(note));
    const editBtn = makeAction('Edit note', 'Edit', () => openEditNote(note));
    const deleteBtn = makeAction('Delete note', 'Delete', () => openDeleteNote(note)); deleteBtn.classList.add('delete-note-btn');
    actions.append(readBtn, editBtn, deleteBtn);
    card.append(pin, title, text, date, actions);
    grid.appendChild(card);
  });
}
function makeAction(label, text, handler){
  const button = document.createElement('button'); button.type = 'button'; button.title = label; button.textContent = text; button.onclick = handler; return button;
}
function selectColor(color, edit = false){
  if(!NOTE_COLORS.includes(color)) return;
  if(edit) editColor = color; else selectedColor = color;
  document.querySelectorAll(edit ? '[data-edit-color]' : '[data-color]').forEach(button => {
    button.classList.toggle('selected', (edit ? button.dataset.editColor : button.dataset.color) === color);
  });
}
function addNote(){
  if(!requireAuth()) return;
  const title = document.getElementById('noteTitleInput').value.trim();
  const text = document.getElementById('noteTextInput').value.trim();
  if(!text){ document.getElementById('noteTextInput').focus(); return; }
  const note = {id:noteId(), title, text, color:selectedColor, read:false, createdAt:Date.now(), updatedAt:Date.now()};
  writeNote(note, 'Note added');
  document.getElementById('noteTitleInput').value = '';
  document.getElementById('noteTextInput').value = '';
}
function writeNote(note, message){
  if(currentUser){ setUserChild(currentUser.uid, 'notes/' + note.id, note).then(() => showToast(message)).catch(error => {console.error(error); showToast('Save failed');}); }
  else { data.notes = [note, ...(data.notes || [])]; persistLocal(); showToast(message); }
}
function toggleRead(note){
  if(!requireAuth()) return;
  if(!window.confirm(note.read ? 'Mark this note as unread?' : 'Mark this note as read?')) return;
  const update = {read:!note.read, updatedAt:Date.now()};
  if(currentUser) updateUserChild(currentUser.uid, 'notes/' + note.id, update).catch(error => {console.error(error); showToast('Update failed');});
  else { Object.assign(note, update); persistLocal(); }
}
function openEditNote(note){
  if(!requireAuth()) return;
  editingNoteId = note.id; editColor = note.color || 'yellow';
  document.getElementById('editNoteTitleInput').value = note.title || '';
  document.getElementById('editNoteTextInput').value = note.text || '';
  selectColor(editColor, true);
  document.getElementById('editNoteBackdrop').classList.add('show');
  document.getElementById('editNoteTextInput').focus();
}
function closeEditNote(){ document.getElementById('editNoteBackdrop').classList.remove('show'); editingNoteId = null; }
function saveEditNote(){
  if(!requireAuth()) return;
  const text = document.getElementById('editNoteTextInput').value.trim();
  if(!text) return;
  const note = data.notes.find(item => item.id === editingNoteId);
  if(!note) return;
  const update = {title:document.getElementById('editNoteTitleInput').value.trim(), text, color:editColor, updatedAt:Date.now()};
  if(!window.confirm('Save these changes to the note?')) return;
  if(currentUser) updateUserChild(currentUser.uid, 'notes/' + note.id, update).then(() => showToast('Note updated')).catch(error => {console.error(error); showToast('Update failed');});
  else { Object.assign(note, update); persistLocal(); showToast('Note updated'); }
  closeEditNote();
}
function openDeleteNote(note){ if(!requireAuth()) return; deletingNoteId = note.id; document.getElementById('deleteNoteMsg').textContent = 'Delete "' + (note.title || 'Untitled note') + '"? This cannot be undone.'; document.getElementById('deleteNoteBackdrop').classList.add('show'); }
function closeDeleteNote(){ document.getElementById('deleteNoteBackdrop').classList.remove('show'); deletingNoteId = null; }
function deleteNote(){
  if(!requireAuth()) return;
  const id = deletingNoteId; if(!id) return;
  if(currentUser) removeUserChild(currentUser.uid, 'notes/' + id).then(() => {closeDeleteNote(); showToast('Note deleted');}).catch(error => {console.error(error); showToast('Delete failed');});
  else { data.notes = data.notes.filter(note => note.id !== id); closeDeleteNote(); persistLocal(); showToast('Note deleted'); }
}

document.getElementById('addNoteBtn').onclick = addNote;
document.getElementById('noteTextInput').addEventListener('keydown', event => { if(event.key === 'Enter' && (event.ctrlKey || event.metaKey)) addNote(); });
document.querySelectorAll('[data-color]').forEach(button => button.onclick = () => selectColor(button.dataset.color));
document.querySelectorAll('[data-edit-color]').forEach(button => button.onclick = () => selectColor(button.dataset.editColor, true));
document.querySelectorAll('.filter-btn').forEach(button => button.onclick = () => { activeFilter = button.dataset.filter; document.querySelectorAll('.filter-btn').forEach(item => item.classList.toggle('active', item === button)); renderNotes(); });
document.getElementById('cancelEditNoteBtn').onclick = closeEditNote;
document.getElementById('saveEditNoteBtn').onclick = saveEditNote;
document.getElementById('cancelDeleteNoteBtn').onclick = closeDeleteNote;
document.getElementById('confirmDeleteNoteBtn').onclick = deleteNote;
document.getElementById('editNoteBackdrop').onclick = event => { if(event.target.id === 'editNoteBackdrop') closeEditNote(); };
document.getElementById('deleteNoteBackdrop').onclick = event => { if(event.target.id === 'deleteNoteBackdrop') closeDeleteNote(); };
const dataMenuBtn = document.getElementById('dataMenuBtn');
if(dataMenuBtn) dataMenuBtn.onclick = event => {
  event.stopPropagation();
  const menu = document.getElementById('dataMenu');
  const isOpen = menu.classList.toggle('show');
  document.getElementById('dataMenuBtn').setAttribute('aria-expanded', String(isOpen));
};
const exportBtn = document.getElementById('exportBtn');
if(exportBtn) exportBtn.onclick = () => {
  if(!requireAuth()) return;
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'word-nest-backup-' + new Date().toISOString().slice(0,10) + '.json';
  link.click();
  URL.revokeObjectURL(url);
  showToast('Backup is downloaded');
};
const importBtn = document.getElementById('importBtn');
if(importBtn) importBtn.onclick = () => { if(requireAuth()) document.getElementById('importFile').click(); };
const importFile = document.getElementById('importFile');
if(importFile) importFile.onchange = event => {
  const file = event.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = async loadEvent => {
    try{
      const imported = JSON.parse(loadEvent.target.result);
      if(!imported.groups || !imported.words){ showToast('The file is not in correct format'); return; }
      for(const group of imported.groups) await setUserChild(currentUser.uid, 'groups/' + group.id, group);
      for(const word of imported.words) await setUserChild(currentUser.uid, 'words/' + word.id, word);
      for(const note of (imported.notes || [])) await setUserChild(currentUser.uid, 'notes/' + note.id, note);
      if(imported.activeGroup) await setUserChild(currentUser.uid, 'activeGroup', imported.activeGroup);
      showToast('All data imported to cloud');
    }catch(error){ console.error(error); showToast('Import failed'); }
    event.target.value = '';
  };
  reader.readAsText(file);
};

function showAuthModal(mode){ document.getElementById('authModalBackdrop').classList.add('show'); document.getElementById('authModalBackdrop').dataset.mode = mode; document.getElementById('authModalTitle').textContent = mode === 'signup' ? 'Sign up' : 'Login'; document.getElementById('confirmAuthBtn').textContent = mode === 'signup' ? 'Sign up' : 'Login'; document.getElementById('authEmail').focus(); }
function closeAuthModal(){ document.getElementById('authModalBackdrop').classList.remove('show'); }
document.getElementById('cancelAuthBtn').onclick = closeAuthModal;
document.getElementById('authModalBackdrop').onclick = event => { if(event.target.id === 'authModalBackdrop') closeAuthModal(); };
document.getElementById('confirmAuthBtn').onclick = async () => { const email = document.getElementById('authEmail').value.trim(); const password = document.getElementById('authPassword').value; if(!email || !password){showToast('Provide email and password'); return;} try{ const mode = document.getElementById('authModalBackdrop').dataset.mode; if(mode === 'signup') await signUpWithEmail(email, password); else await signInWithEmail(email, password); closeAuthModal(); showToast('Signed in'); }catch(error){console.error(error); showToast(error.message || 'Auth error');} };
onAuthStateChanged(async user => {
  currentUser = user;
  if(user){
    await startUserSync(user.uid);
    document.documentElement.classList.remove('auth-pending');
  }else{
    window.location.replace('home.html');
    return;
  }
});

document.addEventListener('click', () => {
  const menu = document.getElementById('dataMenu');
  if(menu) menu.classList.remove('show');
  const toggle = document.getElementById('dataMenuBtn');
  if(toggle) toggle.setAttribute('aria-expanded', 'false');
});

renderNotes();
