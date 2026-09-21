import {
  addGroup,
  addWord,
  deleteGroup,
  deleteWord,
  importVocabulary,
  renameGroup,
  setActiveGroup,
  subscribeToVocabulary,
  updateWord,
} from './src/repositories/vocabularyRepository.js';
import { initFirebase } from './src/firebase/config.js';
import { onAuthStateChanged, signUpWithEmail, signInWithEmail, signOutUser } from './src/firebase/auth.js';
import { finishDataLoading, showAuthenticatedShell, showUnauthorized } from './src/app/app.js';
import { setAppState } from './src/app/state.js';
import { createEmptyModel, createId, escapeHtml } from './src/features/vocabulary/model.js';
import { createImportPlan } from './src/features/import-export/mergePlan.js';

const STORAGE_KEY = 'wordnest_data_v1';

// Firebase runtime state
initFirebase();
let currentUser = null;
let currentListenerUid = null;
let stopVocabularySubscription = null;

async function startUserSync(uid){
  // avoid duplicate listeners
  if(currentListenerUid === uid) return;
  if(stopVocabularySubscription) stopVocabularySubscription();
  currentListenerUid = uid;

  // start realtime listener
  stopVocabularySubscription = subscribeToVocabulary(uid, normalized => {
    const previous = data;
    replaceData(normalized);
    saveData();
    if(groupsNeedRefresh(previous, normalized)) renderGroups();
    renderWords();
    finishDataLoading();
  });
}

function stopUserSync(){
  if(stopVocabularySubscription) stopVocabularySubscription();
  stopVocabularySubscription = null;
  currentListenerUid = null;
}


let data = createEmptyModel();
setAppState({ data, vocabulary: data.words, groups: data.groups });

function replaceData(nextData){
  data = nextData;
  setAppState({ data, vocabulary: data.words, groups: data.groups });
}
let searchQuery = '';
let searchTimer = null;
let groupModalMode = 'create'; // 'create' | 'rename'
let editingWordId = null;
let pendingEditSave = null;
let groupPendingDelete = null;
let wordPendingDelete = null;
let openMenuGroupId = null;

function saveData(){
  // All user data is persisted in Firebase only.
}

function requireAuth(){
  if(currentUser) return true;
  showAuthModal('login');
  return false;
}

function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.remove('show'), 2200);
}

function render(){
  renderGroups();
  renderWords();
  saveData();
}

function groupsNeedRefresh(previous, next){
  if(previous.activeGroup !== next.activeGroup || previous.groups.length !== next.groups.length) return true;
  return next.groups.some((group, index) => {
    const oldGroup = previous.groups[index];
    if(!oldGroup || oldGroup.id !== group.id || oldGroup.name !== group.name) return true;
    const oldCount = previous.words.filter(word => word.groupId === group.id).length;
    const newCount = next.words.filter(word => word.groupId === group.id).length;
    return oldCount !== newCount;
  });
}

function renderGroups(){
  const row = document.getElementById('groupsRow');
  row.innerHTML = '';
  data.groups.forEach(g => {
    const count = data.words.filter(w => w.groupId === g.id).length;

    const wrap = document.createElement('div');
    wrap.className = 'group-chip-wrap';

    const chip = document.createElement('button');
    chip.className = 'group-chip' + (g.id === data.activeGroup ? ' active' : '');
    chip.innerHTML = g.name + ' <span class="count">' + count + '</span>' +
      (data.groups.length > 1 ? ' <span class="group-menu-btn" data-menu="' + g.id + '">&#8942;</span>' : '');
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      if(!requireAuth()) return;
      if(e.target.dataset.menu){
        openMenuGroupId = (openMenuGroupId === g.id) ? null : g.id;
        renderGroups();
        return;
      }
      data.activeGroup = g.id;
      searchQuery = '';
      document.getElementById('searchInput').value = '';
      render();
    });
    wrap.appendChild(chip);

    if(openMenuGroupId === g.id){
      const menu = document.createElement('div');
      menu.className = 'group-menu show';
      const renameBtn = document.createElement('button');
      renameBtn.textContent = 'change name';
      renameBtn.onclick = () => { openMenuGroupId = null; openGroupModal('rename', g.id); };
      const delBtn = document.createElement('button');
      delBtn.className = 'danger-item';
      delBtn.textContent = 'delete';
      delBtn.onclick = () => { openMenuGroupId = null; openDeleteGroupModal(g.id); };
      menu.appendChild(renameBtn);
      menu.appendChild(delBtn);
      wrap.appendChild(menu);
    }

    row.appendChild(wrap);
  });
  const newBtn = document.createElement('button');
  newBtn.className = 'group-chip-new';
  newBtn.textContent = '+ new group';
  newBtn.onclick = () => openGroupModal('create');
  row.appendChild(newBtn);
}

function renderWords(){
  const grid = document.getElementById('wordGrid');
  grid.innerHTML = '';
  // Ensure activeGroup exists; do not switch the user's current group on partial updates.
  // Only set a default when there is no activeGroup but groups are available.
  if(!data.activeGroup && data.groups && data.groups.length > 0){
    data.activeGroup = data.groups[0].id;
    try{ saveData(); }catch(e){}
  }

  let words = data.words.filter(w => w.groupId === data.activeGroup);

  if(searchQuery){
    const q = searchQuery.toLowerCase();
    words = words.filter(w =>
      w.text.toLowerCase().includes(q) ||
      (w.meaning && w.meaning.toLowerCase().includes(q))
    );
  }

  document.getElementById('totalCount').textContent = data.words.length + ' words';

  if(words.length === 0){
    const msg = searchQuery
      ? 'No words found.'
      : 'There are no words in this group yet.';
    const sub = searchQuery
      ? 'Try something else.'
      : 'Start by adding an English word from above.';
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">' +
      '<span class="word-serif">' + msg + '</span>' + sub +
      '</div>';
    return;
  }
  

  words.forEach(w => {
    const card = document.createElement('div');
    card.className = 'word-card' + (w.read ? ' read' : '');

    // right-side actions (mark / edit / delete)
    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const markBtn = document.createElement('button');
    markBtn.className = 'icon-btn mark-btn';
    markBtn.title = w.read ? 'Mark as unread' : 'Mark as read';
    markBtn.textContent = w.read ? '✓' : '○';
    markBtn.onclick = (e) => {
      e.stopPropagation();
      if(!requireAuth()) return;
      if(currentUser){
        updateWord(currentUser.uid, w.id, { read: !w.read }).then(()=>{}).catch(err=>{ console.error(err); showToast('Update failed'); });
      } else {
        w.read = !w.read;
        showToast(w.read ? 'Marked as read' : 'Marked as unread');
        saveData(); render();
      }
    };
    // append mark button before edit
    actions.appendChild(markBtn);

    const editBtn = document.createElement('button');
    editBtn.className = 'icon-btn';
    editBtn.innerHTML = '&#9998;';
    editBtn.title = 'Edit';
    editBtn.onclick = () => openEditModal(w.id);

    const delBtn = document.createElement('button');
    delBtn.className = 'icon-btn del-btn';
    delBtn.innerHTML = '&times;';
    delBtn.title = 'Delete';
    delBtn.onclick = () => openDeleteWordModal(w.id);

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    const wordEl = document.createElement('p');
    wordEl.className = 'word';
    wordEl.textContent = w.text;

    const meaningBtn = document.createElement('button');
    if(w.revealed){
      meaningBtn.className = 'meaning-revealed';
      meaningBtn.textContent = w.meaning ? w.meaning : 'Meaning did not save';
    } else {
      meaningBtn.className = 'meaning-toggle';
      meaningBtn.textContent = 'tap to see meaning';
    }
    meaningBtn.onclick = () => {
      if(!requireAuth()) return;
      if(currentUser){
        updateWord(currentUser.uid, w.id, { revealed: !w.revealed }).then(()=>{}).catch(err=>{ console.error(err); showToast('Update failed'); });
      } else {
        w.revealed = !w.revealed;
        saveData(); render();
      }
    };

    card.appendChild(actions);
    card.appendChild(wordEl);
    card.appendChild(meaningBtn);

    if(w.example && w.example.trim()){
      const exEl = document.createElement('p');
      exEl.className = 'example-line';
      exEl.innerHTML = highlightWordInExample(w.example, w.text);
      card.appendChild(exEl);
    }

    grid.appendChild(card);
  });
}

function highlightWordInExample(example, word){
  const escaped = escapeHtml(example);
  const wordEsc = word.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if(!wordEsc) return escaped;
  const re = new RegExp('(' + wordEsc + '\\w*)', 'gi');
  return escaped.replace(re, '<b>$1</b>');
}

document.getElementById('addWordBtn').onclick = () => {
  if(!requireAuth()) return;
  const wordInput = document.getElementById('wordInput');
  const meaningInput = document.getElementById('meaningInput');
  const exampleInput = document.getElementById('exampleInput');
  const text = wordInput.value.trim();
  if(!text){
    wordInput.style.borderColor = '#B5502F';
    wordInput.focus();
    return;
  }
  wordInput.style.borderColor = '';
  const newWord = {
    id: createId(),
    text: text,
    meaning: meaningInput.value.trim(),
    example: exampleInput.value.trim(),
    groupId: data.activeGroup,
    revealed: false,
    read: false
  };
  if(currentUser){
    // write single word to cloud; listener will update UI
    addWord(currentUser.uid, newWord).then(() => {
      showToast('Saved');
    }).catch(err => { showToast('Save failed'); console.error(err); });
  } else {
    data.words.unshift(newWord);
    saveData();
    render();
  }
  wordInput.value = '';
  meaningInput.value = '';
  exampleInput.value = '';
  wordInput.focus();
};

document.getElementById('wordInput').addEventListener('keydown', e => {
  if(e.key === 'Enter') document.getElementById('meaningInput').focus();
});
document.getElementById('meaningInput').addEventListener('keydown', e => {
  if(e.key === 'Enter') document.getElementById('exampleInput').focus();
});
document.getElementById('exampleInput').addEventListener('keydown', e => {
  if(e.key === 'Enter') document.getElementById('addWordBtn').click();
});

/* ---- Auth UI modal helpers (simple) ---- */
/* ---- Auth UI modal helpers (static modal) ---- */
function showAuthModal(mode){
  // mode: 'login' | 'signup'
  const bd = document.getElementById('authModalBackdrop');
  if(!bd) return;
  bd.classList.add('show');
  bd.setAttribute('aria-hidden', 'false');
  bd.dataset.mode = mode;
  const title = document.getElementById('authModalTitle');
  const confirm = document.getElementById('confirmAuthBtn');
  if(mode === 'signup'){
    title.textContent = 'Sign up';
    confirm.textContent = 'Sign up';
  } else {
    title.textContent = 'Login';
    confirm.textContent = 'Login';
  }
  document.getElementById('authEmail').value = '';
  document.getElementById('authPassword').value = '';
  document.getElementById('authEmail').focus();
}
function hideAuthModal(){
  const bd = document.getElementById('authModalBackdrop');
  if(!bd) return;
  bd.classList.remove('show');
  bd.setAttribute('aria-hidden', 'true');
}

function showLogoutModal(){
  const bd = document.getElementById('logoutBackdrop');
  if(!bd) return;
  bd.classList.add('show');
  document.getElementById('cancelLogoutBtn').focus();
}
function hideLogoutModal(){
  const bd = document.getElementById('logoutBackdrop');
  if(!bd) return;
  bd.classList.remove('show');
}
document.getElementById('cancelLogoutBtn').onclick = () => hideLogoutModal();
document.getElementById('logoutBackdrop').addEventListener('click', e => { if(e.target.id === 'logoutBackdrop') hideLogoutModal(); });
document.getElementById('confirmLogoutBtn').onclick = async () => {
  hideLogoutModal();
  try{ await signOutUser(); showToast('Signed out'); }catch(e){ console.error(e); showToast('Sign out failed'); }
};

// listen for auth state changes
onAuthStateChanged(async user => {
  if(user){
    currentUser = user;
    showAuthenticatedShell(user);
    startUserSync(user.uid).catch(error => {
      console.error(error);
      finishDataLoading();
      showToast('Could not load your vocabulary');
    });
  } else {
    showUnauthorized();
    window.location.replace('home.html');
    return;
    currentUser = null;
    document.getElementById('logoutBtn').style.display = 'none';
    document.getElementById('loginBtn').style.display = 'inline-block';
    document.getElementById('signupBtn').style.display = 'inline-block';
    document.getElementById('userEmail').textContent = '';
    stopUserSync();
    // On sign-out, remove cached user vocabulary so the next visitor doesn't see it.
    try{ localStorage.removeItem(STORAGE_KEY); }catch(e){}
    // reset cloud-only mode flag when signed out
    window.cloudOnlyMode = false;
    // seed with default empty model (do not reload stale local data)
    replaceData(createEmptyModel());
    render();
  }
});

// auth modal buttons
document.getElementById('cancelAuthBtn').onclick = () => hideAuthModal();
document.getElementById('authModalBackdrop').addEventListener('click', e => { if(e.target.id === 'authModalBackdrop') hideAuthModal(); });
document.getElementById('confirmAuthBtn').onclick = async () => {
  const mode = document.getElementById('authModalBackdrop').dataset.mode || 'login';
  const email = document.getElementById('authEmail').value.trim();
  const pwd = document.getElementById('authPassword').value;
  if(!email || !pwd){ showToast('Provide email and password'); return; }
  try{
    if(mode === 'signup'){
      await signUpWithEmail(email, pwd);
      showToast('Signed up');
    } else {
      await signInWithEmail(email, pwd);
      showToast('Signed in');
    }
    hideAuthModal();
  }catch(err){ console.error(err); showToast(err.message || 'Auth error'); }
};

/* ---- Search ---- */
document.getElementById('searchInput').addEventListener('input', e => {
  searchQuery = e.target.value.trim();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => renderWords(), 120);
});

/* ---- Group create/rename modal ---- */
function openGroupModal(mode, groupId){
  if(!requireAuth()) return;
  groupModalMode = mode;
  const titleEl = document.getElementById('groupModalTitle');
  const saveBtn = document.getElementById('saveGroupBtn');
  const input = document.getElementById('newGroupInput');
  if(mode === 'rename'){
    titleEl.textContent = 'Change group name';
    saveBtn.textContent = 'save';
    const g = data.groups.find(g => g.id === groupId);
    input.value = g ? g.name : '';
    input.dataset.editingId = groupId;
  } else {
    titleEl.textContent = 'New group';
    saveBtn.textContent = 'Create';
    input.value = '';
    delete input.dataset.editingId;
  }
  document.getElementById('modalBackdrop').classList.add('show');
  input.focus();
}
function closeGroupModal(){
  document.getElementById('modalBackdrop').classList.remove('show');
}
document.getElementById('cancelGroupBtn').onclick = closeGroupModal;
document.getElementById('modalBackdrop').addEventListener('click', e => {
  if(e.target.id === 'modalBackdrop') closeGroupModal();
});
document.getElementById('saveGroupBtn').onclick = () => {
  if(!requireAuth()) return;
  const input = document.getElementById('newGroupInput');
  const name = input.value.trim();
  if(!name){
    input.style.borderColor = '#B5502F';
    return;
  }
  input.style.borderColor = '';
  if(groupModalMode === 'rename' && input.dataset.editingId){
    const id = input.dataset.editingId;
    if(currentUser){
      renameGroup(currentUser.uid, id, name).catch(err => { console.error(err); showToast('Update failed'); });
    } else {
      const g = data.groups.find(g => g.id === id);
      if(g) g.name = name;
    }
  } else {
    const id = createId('g');
    if(currentUser){
      addGroup(currentUser.uid, { id, name }).then(()=>{
        setActiveGroup(currentUser.uid, id);
      }).catch(err => { console.error(err); showToast('Create failed'); });
    } else {
      data.groups.push({id, name});
      data.activeGroup = id;
    }
  }
  closeGroupModal();
  render();
};
document.getElementById('newGroupInput').addEventListener('keydown', e => {
  if(e.key === 'Enter') document.getElementById('saveGroupBtn').click();
});

// Auth modal: Enter navigates to password then confirm
document.getElementById('authEmail').addEventListener('keydown', e => {
  if(e.key === 'Enter'){
    e.preventDefault();
    document.getElementById('authPassword').focus();
  }
});
document.getElementById('authPassword').addEventListener('keydown', e => {
  if(e.key === 'Enter'){
    e.preventDefault();
    document.getElementById('confirmAuthBtn').click();
  }
});

// Password show/hide toggle for auth modal (eye icon inside input)
const toggleBtn = document.getElementById('toggleAuthPassword');
if(toggleBtn){
  const eyeIcon = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 5C7 5 2.73 8.11 1 12c1.73 3.89 6 7 11 7s9.27-3.11 11-7c-1.73-3.89-6-7-11-7zm0 12a5 5 0 110-10 5 5 0 010 10z"/><circle cx="12" cy="12" r="2.5"/></svg>';
  const eyeOffIcon = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 6a9.77 9.77 0 018.94 5.5A12.29 12.29 0 0019 13a9.77 9.77 0 01-7 3 9.77 9.77 0 01-8.94-5.5A12.29 12.29 0 005 11c1.5-2.98 4.5-5 7-5zm9.19 13.19L4.81 3.81 3.4 5.22l2.1 2.1A12.25 12.25 0 001 12s4 7 11 7a12.33 12.33 0 005.68-1.28l2.12 2.12 1.41-1.41z"/></svg>';
  // initialize as hidden (eye icon means show password)
  toggleBtn.innerHTML = eyeIcon;
  toggleBtn.setAttribute('aria-label', 'Show password');
  toggleBtn.addEventListener('click', () => {
    const pwd = document.getElementById('authPassword');
    if(!pwd) return;
    if(pwd.type === 'password'){
      pwd.type = 'text';
      toggleBtn.innerHTML = eyeOffIcon;
      toggleBtn.setAttribute('aria-label', 'Hide password');
    } else {
      pwd.type = 'password';
      toggleBtn.innerHTML = eyeIcon;
      toggleBtn.setAttribute('aria-label', 'Show password');
    }
    pwd.focus();
  });
}

/* ---- Group delete ---- */
function openDeleteGroupModal(groupId){
  if(!requireAuth()) return;
  groupPendingDelete = groupId;
  const g = data.groups.find(g => g.id === groupId);
  const count = data.words.filter(w => w.groupId === groupId).length;
  document.getElementById('deleteGroupMsg').textContent =
    '"' + (g ? g.name : '') + '". It will delete the group and also ' + count + ' words which cannot be restored.';
  document.getElementById('deleteGroupBackdrop').classList.add('show');
}
document.getElementById('cancelDeleteGroupBtn').onclick = () => {
  document.getElementById('deleteGroupBackdrop').classList.remove('show');
  groupPendingDelete = null;
};
document.getElementById('deleteGroupBackdrop').addEventListener('click', e => {
  if(e.target.id === 'deleteGroupBackdrop'){
    e.currentTarget.classList.remove('show');
    groupPendingDelete = null;
  }
});
document.getElementById('confirmDeleteGroupBtn').onclick = () => {
  if(!requireAuth()) return;
  if(!groupPendingDelete) return;
  const gid = groupPendingDelete;
  if(currentUser){
    (async () => {
      try{
        await deleteGroup(currentUser.uid, gid);
        document.getElementById('deleteGroupBackdrop').classList.remove('show');
        groupPendingDelete = null;
        showToast('Group is deleted');
      }catch(err){ console.error(err); showToast('Delete failed'); }
    })();
  } else {
    data.words = data.words.filter(w => w.groupId !== gid);
    data.groups = data.groups.filter(g => g.id !== gid);
    if(data.groups.length === 0){
      const id = createId('g');
      data.groups.push({id, name:'General'});
      data.activeGroup = id;
    } else if(data.activeGroup === gid){
      data.activeGroup = data.groups[0].id;
    }
    document.getElementById('deleteGroupBackdrop').classList.remove('show');
    groupPendingDelete = null;
    showToast('Group is deleted');
    render();
  }
};

/* ---- Word edit ---- */
function openEditModal(wordId){
  if(!requireAuth()) return;
  editingWordId = wordId;
  const w = data.words.find(w => w.id === wordId);
  if(!w) return;
  document.getElementById('editWordInput').value = w.text;
  document.getElementById('editMeaningInput').value = w.meaning || '';
  document.getElementById('editExampleInput').value = w.example || '';
  document.getElementById('editModalBackdrop').classList.add('show');
  document.getElementById('editWordInput').focus();
}
function closeEditModal(){
  document.getElementById('editModalBackdrop').classList.remove('show');
  editingWordId = null;
}
document.getElementById('cancelEditBtn').onclick = closeEditModal;
document.getElementById('editModalBackdrop').addEventListener('click', e => {
  if(e.target.id === 'editModalBackdrop') closeEditModal();
});
document.getElementById('saveEditBtn').onclick = () => {
  if(!requireAuth()) return;
  const textInput = document.getElementById('editWordInput');
  const text = textInput.value.trim();
  if(!text){
    textInput.style.borderColor = '#B5502F';
    return;
  }
  textInput.style.borderColor = '';
  const w = data.words.find(w => w.id === editingWordId);
  const newVals = { text, meaning: document.getElementById('editMeaningInput').value.trim(), example: document.getElementById('editExampleInput').value.trim() };
  if(!w) return;
  pendingEditSave = {word:w, values:newVals};
  document.getElementById('editConfirmBackdrop').classList.add('show');
};
function closeEditConfirmation(){
  pendingEditSave = null;
  document.getElementById('editConfirmBackdrop').classList.remove('show');
}
document.getElementById('cancelEditConfirmBtn').onclick = closeEditConfirmation;
document.getElementById('editConfirmBackdrop').addEventListener('click', event => {
  if(event.target.id === 'editConfirmBackdrop') closeEditConfirmation();
});
document.getElementById('confirmEditBtn').onclick = () => {
  if(!pendingEditSave) return;
  const {word, values} = pendingEditSave;
  if(currentUser){
    const merged = Object.assign({}, word, values);
    updateWord(currentUser.uid, word.id, merged).catch(err => { console.error(err); showToast('Save failed'); });
  } else {
    word.text = values.text;
    word.meaning = values.meaning;
    word.example = values.example;
    closeEditModal();
    render();
  }
  closeEditConfirmation();
  closeEditModal();
};

// Enter-key navigation inside edit modal: move focus forward, save on final Enter
document.getElementById('editWordInput').addEventListener('keydown', e => {
  if(e.key === 'Enter'){
    e.preventDefault();
    document.getElementById('editMeaningInput').focus();
  }
});
document.getElementById('editMeaningInput').addEventListener('keydown', e => {
  if(e.key === 'Enter'){
    e.preventDefault();
    document.getElementById('editExampleInput').focus();
  }
});
document.getElementById('editExampleInput').addEventListener('keydown', e => {
  if(e.key === 'Enter'){
    e.preventDefault();
    document.getElementById('saveEditBtn').click();
  }
});

/* ---- Export ---- */
const exportBtn = document.getElementById('exportBtn');
if(exportBtn) exportBtn.onclick = () => {
  if(!requireAuth()) return;
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateStr = new Date().toISOString().slice(0,10);
  a.href = url;
  a.download = 'word-nest-backup-' + dateStr + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Backup is downloaded');
};

/* ---- Import: merge, never blind-replace ---- */
let pendingImport = null;

const importBtn = document.getElementById('importBtn');
if(importBtn) importBtn.onclick = () => {
  if(!requireAuth()) return;
  document.getElementById('importFile').click();
};
const dataMenuBtn = document.getElementById('dataMenuBtn');
if(dataMenuBtn) dataMenuBtn.onclick = event => {
  event.stopPropagation();
  const menu = document.getElementById('dataMenu');
  const isOpen = menu.classList.toggle('show');
  document.getElementById('dataMenuBtn').setAttribute('aria-expanded', String(isOpen));
};
const importFile = document.getElementById('importFile');
if(importFile) importFile.addEventListener('change', e => {
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = evt => {
    try{
      const imported = JSON.parse(evt.target.result);
          if(!imported.groups || !imported.words){
        showToast('The file is not in correct format');
        e.target.value = '';
        return;
      }
      startMerge(imported);
    }catch(err){
      showToast('There occured a problem reading this file');
    }
    e.target.value = '';
  };
  reader.readAsText(file);
});

function startMerge(imported){
  pendingImport = createImportPlan(imported, data);

  if(pendingImport.conflicts.length === 0){
    applyImport('keep_new'); // no conflicts, nothing to choose
  } else {
    renderMergeModal();
    document.getElementById('mergeModalBackdrop').classList.add('show');
  }
}

function renderMergeModal(){
  const list = document.getElementById('mergeList');
  list.innerHTML = '';
  pendingImport.conflicts.forEach((c, idx) => {
    const item = document.createElement('div');
    item.className = 'merge-item';
    const groupName = (data.groups.find(g => g.id === c.groupId) ||
      pendingImport.groupsToAdd.find(g => g.id === c.groupId) || {}).name || '';
    item.innerHTML =
      '<p class="mi-word">' + escapeHtml(c.imported.text) + ' <span style="font-size:12px; color:var(--ink-soft); font-family:\'Inter\',sans-serif;">(' + escapeHtml(groupName) + ')</span></p>' +
      '<div class="merge-options">' +
        '<label><input type="radio" name="merge_' + idx + '" value="keep_existing" checked> keep present — <span class="mi-meaning">' + escapeHtml(c.existing.meaning || 'no meaning') + '</span></label>' +
        '<label><input type="radio" name="merge_' + idx + '" value="keep_new"> override with new — <span class="mi-meaning">' + escapeHtml(c.imported.meaning || 'no meaning') + '</span></label>' +
        '<label><input type="radio" name="merge_' + idx + '" value="keep_both"> keep both </label>' +
      '</div>';
    list.appendChild(item);
  });
}

document.getElementById('cancelMergeBtn').onclick = () => {
  document.getElementById('mergeModalBackdrop').classList.remove('show');
  pendingImport = null;
  showToast('Import canceled');
};
document.getElementById('mergeModalBackdrop').addEventListener('click', e => {
  if(e.target.id === 'mergeModalBackdrop'){
    e.currentTarget.classList.remove('show');
    pendingImport = null;
  }
});
document.getElementById('confirmMergeBtn').onclick = () => {
  if(!pendingImport) return;
  const choices = pendingImport.conflicts.map((c, idx) => {
    const sel = document.querySelector('input[name="merge_' + idx + '"]:checked');
    return sel ? sel.value : 'keep_existing';
  });
  applyImport(choices);
  document.getElementById('mergeModalBackdrop').classList.remove('show');
};

async function applyImport(conflictChoices){
  if(!pendingImport) return;
  const {groupsToAdd, wordsToAdd, conflicts} = pendingImport;
  if(currentUser){
    try{
        await importVocabulary(currentUser.uid, pendingImport, conflictChoices);
    }catch(err){ console.error(err); showToast('Import failed'); pendingImport = null; return; }
    pendingImport = null;
    showToast('Import successful — uploaded to cloud');
    // cloud listener will update UI
    return;
  }

  // offline/local import behavior
  data.groups.push(...groupsToAdd);
  data.words.push(...wordsToAdd);

  conflicts.forEach((c, idx) => {
    const choice = Array.isArray(conflictChoices) ? conflictChoices[idx] : conflictChoices;
    if(choice === 'keep_new'){
      c.existing.text = c.imported.text;
      c.existing.meaning = c.imported.meaning || '';
      c.existing.example = c.imported.example || '';
    } else if(choice === 'keep_both'){
      data.words.push({
        id: createId(),
        text: c.imported.text,
        meaning: c.imported.meaning || '',
        example: c.imported.example || '',
        groupId: c.groupId,
        revealed: false
      });
    }
    // keep_existing -> do nothing
  });

  const addedCount = wordsToAdd.length;
  const conflictCount = conflicts.length;
  pendingImport = null;
  render();
  showToast('import successful — ' + addedCount + ' new words added' + (conflictCount ? ', ' + conflictCount + ' collisions solved' : ''));
}

/* Close group menu on outside click */
document.addEventListener('click', () => {
  if(openMenuGroupId !== null){
    openMenuGroupId = null;
    renderGroups();
  }
  const menu = document.getElementById('dataMenu');
  if(menu) menu.classList.remove('show');
  const toggle = document.getElementById('dataMenuBtn');
  if(toggle) toggle.setAttribute('aria-expanded', 'false');
});

/* ---- Word delete confirmation handlers (inserted at end) ---- */
function openDeleteWordModal(wordId){
  if(!requireAuth()) return;
  wordPendingDelete = wordId;
  const w = data.words.find(x => x.id === wordId);
  const msgEl = document.getElementById('deleteWordMsg');
  if(msgEl) msgEl.textContent = 'Delete "' + (w ? w.text : '') + '"? This action cannot be undone.';
  const bd = document.getElementById('deleteWordBackdrop');
  if(bd) bd.classList.add('show');
}
document.getElementById('cancelDeleteWordBtn').onclick = () => {
  const bd = document.getElementById('deleteWordBackdrop');
  if(bd) bd.classList.remove('show');
  wordPendingDelete = null;
};
document.getElementById('deleteWordBackdrop').addEventListener('click', e => {
  if(e.target.id === 'deleteWordBackdrop'){
    e.currentTarget.classList.remove('show');
    wordPendingDelete = null;
  }
});
document.getElementById('confirmDeleteWordBtn').onclick = () => {
  if(!requireAuth()) return;
  if(!wordPendingDelete) return;
  const wid = wordPendingDelete;
  if(currentUser){
    deleteWord(currentUser.uid, wid).then(()=>{
      const bd = document.getElementById('deleteWordBackdrop');
      if(bd) bd.classList.remove('show');
      wordPendingDelete = null;
      showToast('Word deleted');
    }).catch(err => { console.error(err); showToast('Delete failed'); });
  } else {
    data.words = data.words.filter(w => w.id !== wordPendingDelete);
    const bd = document.getElementById('deleteWordBackdrop');
    if(bd) bd.classList.remove('show');
    wordPendingDelete = null;
    showToast('Word deleted');
    render();
  }
};

/* ---- Mark all read/unread modal handlers ---- */
document.getElementById('markAllBtn').onclick = () => {
  if(!requireAuth()) return;
  document.getElementById('markAllBackdrop').classList.add('show');
};
// enter on mark-all radios should move focus to confirm
document.querySelectorAll('input[name="mark_all_choice"]').forEach(el => {
  el.addEventListener('keydown', e => {
    if(e.key === 'Enter'){
      e.preventDefault();
      document.getElementById('confirmMarkAllBtn').focus();
    }
  });
});
document.getElementById('cancelMarkAllBtn').onclick = () => {
  document.getElementById('markAllBackdrop').classList.remove('show');
};
document.getElementById('markAllBackdrop').addEventListener('click', e => {
  if(e.target.id === 'markAllBackdrop') e.currentTarget.classList.remove('show');
});
document.getElementById('confirmMarkAllBtn').onclick = () => {
  const sel = document.querySelector('input[name="mark_all_choice"]:checked');
  if(!sel) return;
  const choice = sel.value; // 'read' or 'unread'
  const want = (choice === 'read');
  if(currentUser){
    data.words.filter(w => w.groupId === data.activeGroup).forEach(w => {
      updateWord(currentUser.uid, w.id, { read: want }).catch(err => console.error(err));
    });
    document.getElementById('markAllBackdrop').classList.remove('show');
    showToast(want ? 'All marked as read' : 'All marked as unread');
  } else {
    data.words.filter(w => w.groupId === data.activeGroup).forEach(w => w.read = want);
    document.getElementById('markAllBackdrop').classList.remove('show');
    render();
    showToast(want ? 'All marked as read' : 'All marked as unread');
  }
};

// removed upload-local UI and handlers (offline upload flow)

render();
