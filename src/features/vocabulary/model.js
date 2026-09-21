export function createEmptyModel() {
  return {
    groups: [{ id: 'default', name: 'general' }],
    activeGroup: 'default',
    words: [],
    notes: []
  };
}

export function normalizeVocabularySnapshot(snapshot) {
  const base = createEmptyModel();
  if (!snapshot) return base;

  const groups = Object.keys(snapshot.groups || {}).map(key => {
    const group = snapshot.groups[key];
    return group ? { id: group.id || key, name: group.name || '' } : null;
  }).filter(Boolean);
  if (!groups.length) groups.push({ id: 'default', name: 'general' });

  const words = Object.keys(snapshot.words || {}).map(key => {
    const word = snapshot.words[key];
    return word ? (word.id ? word : { ...word, id: key }) : null;
  }).filter(Boolean);

  const notes = Object.keys(snapshot.notes || {}).map(key => {
    const note = snapshot.notes[key];
    return note ? { ...note, id: note.id || key } : null;
  }).filter(Boolean);

  const activeGroup = groups.some(group => group.id === snapshot.activeGroup)
    ? snapshot.activeGroup
    : groups[0].id;

  return { groups, activeGroup, words, notes };
}

export function createId(prefix = 'w') {
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

export function escapeHtml(value) {
  const element = document.createElement('div');
  element.textContent = value == null ? '' : value;
  return element.innerHTML;
}
