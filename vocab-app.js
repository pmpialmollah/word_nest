const STORAGE_KEY = 'wordnest_data_v1';

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
    markBtn.onclick = (e) => { e.stopPropagation(); w.read = !w.read; showToast(w.read ? 'Marked as read' : 'Marked as unread'); render(); };
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
      w.revealed = !w.revealed;
      render();
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
  data.words.unshift({
    id: cryptoId(),
    text: text,
    meaning: meaningInput.value.trim(),
    example: exampleInput.value.trim(),
    groupId: data.activeGroup,
    revealed: false
  });
  wordInput.value = '';
  meaningInput.value = '';
  exampleInput.value = '';
  wordInput.focus();
  render();
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
    const g = data.groups.find(g => g.id === input.dataset.editingId);
    if(g) g.name = name;
  } else {
    const id = cryptoId();
    data.groups.push({id, name});
    data.activeGroup = id;
  }
  closeGroupModal();
  render();
};
document.getElementById('newGroupInput').addEventListener('keydown', e => {
  if(e.key === 'Enter') document.getElementById('saveGroupBtn').click();
});

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
  data.words = data.words.filter(w => w.groupId !== groupPendingDelete);
  data.groups = data.groups.filter(g => g.id !== groupPendingDelete);
  if(data.groups.length === 0){
    const id = cryptoId();
    data.groups.push({id, name:'General'});
    data.activeGroup = id;
  } else if(data.activeGroup === groupPendingDelete){
    data.activeGroup = data.groups[0].id;
  }
  document.getElementById('deleteGroupBackdrop').classList.remove('show');
  groupPendingDelete = null;
  showToast('Group is deleted');
  render();
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
  if(w){
    w.text = text;
    w.meaning = document.getElementById('editMeaningInput').value.trim();
    w.example = document.getElementById('editExampleInput').value.trim();
  }
  closeEditModal();
  render();
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

function applyImport(conflictChoices){
  if(!pendingImport) return;
  const {groupsToAdd, wordsToAddDirect, conflicts} = pendingImport;

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
  data.words = data.words.filter(w => w.id !== wordPendingDelete);
  const bd = document.getElementById('deleteWordBackdrop');
  if(bd) bd.classList.remove('show');
  wordPendingDelete = null;
  showToast('Word deleted');
  render();
};

/* ---- Mark all read/unread modal handlers ---- */
document.getElementById('markAllBtn').onclick = () => {
  document.getElementById('markAllBackdrop').classList.add('show');
};
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
  data.words.filter(w => w.groupId === data.activeGroup).forEach(w => w.read = (choice === 'read'));
  document.getElementById('markAllBackdrop').classList.remove('show');
  render();
  showToast(choice === 'read' ? 'All marked as read' : 'All marked as unread');
};

render();
