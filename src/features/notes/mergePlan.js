import { createId } from '../vocabulary/model.js';

function noteKey(note) {
  return [note.title || '', note.text || note.richText || '']
    .join('|')
    .trim()
    .toLowerCase();
}

export function createNoteImportPlan(importedNotes, existingNotes) {
  const notesToAdd = [];
  const conflicts = [];

  (importedNotes || []).forEach(note => {
    const existing = (existingNotes || []).find(item => noteKey(item) === noteKey(note));
    if (existing) conflicts.push({ imported: note, existing });
    else notesToAdd.push({ ...note, id: createId('n') });
  });

  return { notesToAdd, conflicts };
}
