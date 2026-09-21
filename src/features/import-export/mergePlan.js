import { createId } from '../vocabulary/model.js';

export function createImportPlan(imported, currentData) {
  const groupIdMap = {};
  const groupsToAdd = [];

  (imported.groups || []).forEach(importedGroup => {
    const existing = currentData.groups.find(group =>
      group.name.trim().toLowerCase() === (importedGroup.name || '').trim().toLowerCase()
    );
    if (existing) groupIdMap[importedGroup.id] = existing.id;
    else {
      const id = createId('g');
      groupIdMap[importedGroup.id] = id;
      groupsToAdd.push({ id, name: importedGroup.name || 'Imported group' });
    }
  });

  const wordsToAdd = [];
  const conflicts = [];
  (imported.words || []).forEach(importedWord => {
    const groupId = groupIdMap[importedWord.groupId];
    if (!groupId) return;
    const existing = currentData.words.find(word =>
      word.groupId === groupId && word.text.trim().toLowerCase() === (importedWord.text || '').trim().toLowerCase()
    );
    if (existing) conflicts.push({ imported: importedWord, existing, groupId });
    else wordsToAdd.push({
      id: createId(),
      text: importedWord.text || '',
      meaning: importedWord.meaning || '',
      example: importedWord.example || '',
      groupId,
      revealed: false,
      read: Boolean(importedWord.read)
    });
  });

  return {
    groupsToAdd,
    wordsToAdd,
    conflicts,
    notesToAdd: (imported.notes || []).map(note => ({ ...note, id: createId('n') }))
  };
}
