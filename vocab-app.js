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

// Firebase runtime state
initFirebase();
let currentUser = null;
let currentListenerUid = null;

function firebaseObjectToAppModel(obj, prev){
  // Merge incoming firebase snapshot `obj` into existing app model `prev`.
  // Keeps the user's `activeGroup` and local groups/words unless the cloud explicitly updates them.
  const base = prev ? { groups: (prev.groups||[]).slice(), words: (prev.words||[]).slice(), activeGroup: prev.activeGroup } : { groups:[{id:'default',name:'general'}], words:[], activeGroup:'default' };

  if(!obj) return base;

  // Merge groups: treat obj.groups as a map of groupId->{id,name}. Merge keys into base.groups
  const groupMap = {};
  (base.groups||[]).forEach(g => { groupMap[g.id] = { id: g.id, name: g.name }; });
  if(obj.groups && Object.keys(obj.groups).length > 0){
    Object.keys(obj.groups).forEach(k => {
      const g = obj.groups[k];
      if(g) groupMap[g.id || k] = { id: g.id || k, name: g.name || '' };
    });
  }
  const groups = Object.keys(groupMap).map(k => groupMap[k]);
  if(groups.length === 0) groups.push({id:'default', name:'general'});

  // Merge words: preserve base order. For each base word, if cloud has an update for same id replace it in place.
  const words = [];
  const cloudWordsMap = {};
  if(obj.words && Object.keys(obj.words).length > 0){
    Object.keys(obj.words).forEach(k => {
      const w = obj.words[k];
      if(w && w.id) cloudWordsMap[w.id] = w;
      else if(w) cloudWordsMap[k] = Object.assign({}, w, { id: k });
    });
  }
  // start with base words in order, replace with cloud version if present
  (base.words||[]).forEach(bw => {
    if(bw && bw.id){
      if(cloudWordsMap[bw.id]){
        words.push(cloudWordsMap[bw.id]);
        delete cloudWordsMap[bw.id];
      } else {
        words.push(bw);
      }
    }
  });
  // append any remaining cloud-only words
  Object.keys(cloudWordsMap).forEach(k => words.push(cloudWordsMap[k]));

  // activeGroup: if we already had a `prev` model, preserve user's selection; only accept cloud activeGroup when prev was not provided.
  let active = base.activeGroup || (groups[0] && groups[0].id) || 'default';
  if(!prev && obj.activeGroup){
    const candidate = obj.activeGroup;
    if(groups.find(g => g.id === candidate)) active = candidate;
  }

  return { groups, activeGroup: active, words };
}

function normalizeAppModelToFirebaseModel(app){
  const out = {};
  out.groups = {};
  (app.groups||[]).forEach(g => { out.groups[g.id] = { id: g.id, name: g.name }; });
  out.words = {};
  (app.words||[]).forEach(w => { out.words[w.id] = w; });
  out.activeGroup = app.activeGroup || (app.groups && app.groups[0] && app.groups[0].id) || 'default';
  return out;
}

async function startUserSync(uid){
  // avoid duplicate listeners
  if(currentListenerUid === uid) return;
  if(currentListenerUid) stopListeningToUser(currentListenerUid);
  currentListenerUid = uid;

  // check cloud data and perform safe migration/merge if necessary
  const cloud = await getUserOnce(uid);
  const local = loadData();
  if(!cloud){
    // cloud empty -> if local has groups or words, upload them
    if(local){
      const hasGroups = Array.isArray(local.groups) && local.groups.length > 0;
      const hasWords = Array.isArray(local.words) && local.words.length > 0;
      if(hasGroups || hasWords){
        const firebaseModel = normalizeAppModelToFirebaseModel(local);
        // write groups, words, activeGroup separately to avoid large rewrites
        if(Object.keys(firebaseModel.groups).length) await setUserChild(uid, 'groups', firebaseModel.groups);
        if(Object.keys(firebaseModel.words).length) await setUserChild(uid, 'words', firebaseModel.words);
        if(firebaseModel.activeGroup) await setUserChild(uid, 'activeGroup', firebaseModel.activeGroup);
        // do NOT remove localStorage; keep it as cache
      }
    }
  } else {
    // cloud exists and local exists -> merge safely (add local-only items to cloud)
    if(local){
      // merge groups: preserve existing cloud groups, add local-only groups
      const cloudGroups = cloud.groups || {};
      const toAddGroups = {};
      (local.groups||[]).forEach(g => { if(!cloudGroups[g.id]) toAddGroups[g.id] = {id:g.id, name:g.name}; });
      if(Object.keys(toAddGroups).length) await setUserChild(uid, 'groups', Object.assign({}, cloudGroups, toAddGroups));

      // merge words: preserve cloud words when IDs collide
      const cloudWords = cloud.words || {};
      const toAddWords = {};
      (local.words||[]).forEach(w => { if(!cloudWords[w.id]) toAddWords[w.id] = w; });
      if(Object.keys(toAddWords).length) await setUserChild(uid, 'words', Object.assign({}, cloudWords, toAddWords));

      // activeGroup: if cloud has none but local has, set it
      if(!cloud.activeGroup && local.activeGroup) await setUserChild(uid, 'activeGroup', local.activeGroup);
    }
  }

  // start realtime listener
  listenToUser(uid, fbObj => {
    const normalized = firebaseObjectToAppModel(fbObj, data);
    data = normalized;
    saveData();
    render();
  });
}

function stopUserSync(){ if(currentListenerUid){ stopListeningToUser(currentListenerUid); currentListenerUid = null; } }


function loadData(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw) return JSON.parse(raw);
  }catch(e){}
  // seed with a default group + sample word so the UI isn't empty on first run
  return {
    groups: [{id:'default', name:'general'}],
    activeGroup: 'default',
    words: [
      // {id: cryptoId(), text:'ephemeral', meaning:'ক্ষণস্থায়ী', example:'Fame in this industry is often ephemeral.', groupId:'default', revealed:false}
    ]
  };
}

function cryptoId(){
  return 'w_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8);
}

let data = loadData();
let searchQuery = '';
let groupModalMode = 'create'; // 'create' | 'rename'
let editingWordId = null;
let groupPendingDelete = null;
let wordPendingDelete = null;
let openMenuGroupId = null;

function saveData(){
  if(window.cloudOnlyMode) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
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
      if(currentUser){
        updateUserChild(currentUser.uid, `words/${w.id}`, { read: !w.read }).then(()=>{}).catch(err=>{ console.error(err); showToast('Update failed'); });
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
      if(currentUser){
        updateUserChild(currentUser.uid, `words/${w.id}`, { revealed: !w.revealed }).then(()=>{}).catch(err=>{ console.error(err); showToast('Update failed'); });
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
    id: cryptoId(),
    text: text,
    meaning: meaningInput.value.trim(),
    example: exampleInput.value.trim(),
    groupId: data.activeGroup,
    revealed: false,
    read: false
  };
  if(currentUser){
    // write single word to cloud; listener will update UI
    setUserChild(currentUser.uid, `words/${newWord.id}`, newWord).then(() => {
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

document.getElementById('loginBtn').onclick = () => showAuthModal('login');
document.getElementById('signupBtn').onclick = () => showAuthModal('signup');
document.getElementById('logoutBtn').onclick = () => showLogoutModal();

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
    document.getElementById('loginBtn').style.display = 'none';
    document.getElementById('signupBtn').style.display = 'none';
    document.getElementById('logoutBtn').style.display = 'inline-block';
    document.getElementById('userEmail').textContent = user.email || '';
    await startUserSync(user.uid);
  } else {
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
    data = { groups: [{id:'default', name:'general'}], activeGroup: 'default', words: [] };
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
  renderWords();
});

/* ---- Group create/rename modal ---- */
function openGroupModal(mode, groupId){
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
      updateUserChild(currentUser.uid, `groups/${id}`, { name }).catch(err => { console.error(err); showToast('Update failed'); });
    } else {
      const g = data.groups.find(g => g.id === id);
      if(g) g.name = name;
    }
  } else {
    const id = cryptoId();
    if(currentUser){
      setUserChild(currentUser.uid, `groups/${id}`, { id, name }).then(()=>{
        setUserChild(currentUser.uid, 'activeGroup', id);
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
  if(!groupPendingDelete) return;
  const gid = groupPendingDelete;
  if(currentUser){
    (async () => {
      try{
        // remove words in that group
        const userData = await getUserOnce(currentUser.uid);
        const words = userData && userData.words ? userData.words : {};
        Object.keys(words).forEach(async wid => {
          const w = words[wid];
          if(w && w.groupId === gid){
            await removeUserChild(currentUser.uid, `words/${wid}`);
          }
        });
        // remove group
        await removeUserChild(currentUser.uid, `groups/${gid}`);
        // ensure at least one group exists
        const after = await getUserOnce(currentUser.uid);
        const groupsLeft = after && after.groups ? Object.keys(after.groups).length : 0;
        if(groupsLeft === 0){
          const id = cryptoId();
          await setUserChild(currentUser.uid, `groups/${id}`, { id, name: 'General' });
          await setUserChild(currentUser.uid, 'activeGroup', id);
        } else {
          const active = after && after.activeGroup ? after.activeGroup : (after && after.groups ? Object.keys(after.groups)[0] : null);
          if(active) await setUserChild(currentUser.uid, 'activeGroup', active);
        }
        document.getElementById('deleteGroupBackdrop').classList.remove('show');
        groupPendingDelete = null;
        showToast('Group is deleted');
      }catch(err){ console.error(err); showToast('Delete failed'); }
    })();
  } else {
    data.words = data.words.filter(w => w.groupId !== gid);
    data.groups = data.groups.filter(g => g.id !== gid);
    if(data.groups.length === 0){
      const id = cryptoId();
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
  const textInput = document.getElementById('editWordInput');
  const text = textInput.value.trim();
  if(!text){
    textInput.style.borderColor = '#B5502F';
    return;
  }
  textInput.style.borderColor = '';
  const w = data.words.find(w => w.id === editingWordId);
  const newVals = { text, meaning: document.getElementById('editMeaningInput').value.trim(), example: document.getElementById('editExampleInput').value.trim() };
  if(currentUser){
    if(w){
      const merged = Object.assign({}, w, newVals);
      setUserChild(currentUser.uid, `words/${w.id}`, merged).catch(err => { console.error(err); showToast('Save failed'); });
    }
  } else {
    if(w){
      w.text = newVals.text;
      w.meaning = newVals.meaning;
      w.example = newVals.example;
    }
    closeEditModal();
    render();
  }
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
document.getElementById('exportBtn').onclick = () => {
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
let pendingImport = null; // { groupsToAdd, wordsToAddDirect, conflicts:[{importedWord, existingWord, targetGroupId}] }

document.getElementById('importBtn').onclick = () => {
  document.getElementById('importFile').click();
};
document.getElementById('importFile').addEventListener('change', e => {
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
  // Map imported group id -> matching existing group (by name, case-insensitive), or mark as new
  const groupIdMap = {}; // importedGroupId -> existingOrNewGroupId
  const groupsToAdd = [];

  imported.groups.forEach(ig => {
    const existing = data.groups.find(g => g.name.trim().toLowerCase() === ig.name.trim().toLowerCase());
    if(existing){
      groupIdMap[ig.id] = existing.id;
    } else {
      const newId = cryptoId();
      groupIdMap[ig.id] = newId;
      groupsToAdd.push({id:newId, name:ig.name});
    }
  });

  const wordsToAddDirect = [];
  const conflicts = [];

  imported.words.forEach(iw => {
    const targetGroupId = groupIdMap[iw.groupId] || null;
    if(!targetGroupId) return; // orphaned word, skip
    const dupe = data.words.find(w =>
      w.groupId === targetGroupId && w.text.trim().toLowerCase() === iw.text.trim().toLowerCase()
    );
    if(dupe){
      conflicts.push({imported: iw, existing: dupe, targetGroupId});
    } else {
      wordsToAddDirect.push({
        id: cryptoId(),
        text: iw.text,
        meaning: iw.meaning || '',
        example: iw.example || '',
        groupId: targetGroupId,
        revealed: false
      });
    }
  });

  pendingImport = {groupsToAdd, wordsToAddDirect, conflicts};

  if(conflicts.length === 0){
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
    const groupName = (data.groups.find(g => g.id === c.targetGroupId) ||
      pendingImport.groupsToAdd.find(g => g.id === c.targetGroupId) || {}).name || '';
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

function escapeHtml(str){
  const d = document.createElement('div');
  d.textContent = str == null ? '' : str;
  return d.innerHTML;
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
  const {groupsToAdd, wordsToAddDirect, conflicts} = pendingImport;
  if(currentUser){
    // write groups
    try{
      for(const g of groupsToAdd){ await setUserChild(currentUser.uid, `groups/${g.id}`, g); }
      for(const w of wordsToAddDirect){ await setUserChild(currentUser.uid, `words/${w.id}`, w); }
      // handle conflicts according to choices
      for(const [idx, c] of conflicts.entries()){
        const choice = Array.isArray(conflictChoices) ? conflictChoices[idx] : conflictChoices;
        if(choice === 'keep_new'){
          // overwrite existing word with imported content but keep existing id
          const existingId = c.existing.id;
          const newVal = Object.assign({}, c.imported, { id: existingId, groupId: c.targetGroupId });
          await setUserChild(currentUser.uid, `words/${existingId}`, newVal);
        } else if(choice === 'keep_both'){
          const newId = cryptoId();
          const newWord = { id: newId, text: c.imported.text, meaning: c.imported.meaning || '', example: c.imported.example || '', groupId: c.targetGroupId, revealed: false };
          await setUserChild(currentUser.uid, `words/${newId}`, newWord);
        }
        // keep_existing -> do nothing
      }
    }catch(err){ console.error(err); showToast('Import failed'); pendingImport = null; return; }
    pendingImport = null;
    showToast('Import successful — uploaded to cloud');
    // cloud listener will update UI
    return;
  }

  // offline/local import behavior
  data.groups.push(...groupsToAdd);
  data.words.push(...wordsToAddDirect);

  conflicts.forEach((c, idx) => {
    const choice = Array.isArray(conflictChoices) ? conflictChoices[idx] : conflictChoices;
    if(choice === 'keep_new'){
      c.existing.text = c.imported.text;
      c.existing.meaning = c.imported.meaning || '';
      c.existing.example = c.imported.example || '';
    } else if(choice === 'keep_both'){
      data.words.push({
        id: cryptoId(),
        text: c.imported.text,
        meaning: c.imported.meaning || '',
        example: c.imported.example || '',
        groupId: c.targetGroupId,
        revealed: false
      });
    }
    // keep_existing -> do nothing
  });

  const addedCount = wordsToAddDirect.length;
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
});

/* ---- Word delete confirmation handlers (inserted at end) ---- */
function openDeleteWordModal(wordId){
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
  if(!wordPendingDelete) return;
  const wid = wordPendingDelete;
  if(currentUser){
    removeUserChild(currentUser.uid, `words/${wid}`).then(()=>{
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
      updateUserChild(currentUser.uid, `words/${w.id}`, { read: want }).catch(err => console.error(err));
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
