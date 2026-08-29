import { useParams } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos } from '@/services';
import { NoteEditorPage } from './NoteEditorPage';
import { SessionNoteEditorPage } from './SessionNoteEditorPage';

/**
 * /patients/$patientId/notes/$noteId dispatches to the heavy Core
 * Assessment editor or the light session SOAP editor based on the note's
 * own noteMode — the first route in this app whose rendered component
 * depends on loaded data rather than the URL shape alone.
 *
 * Defaults to heavy whenever noteMode isn't literally 'session' — covers
 * both a still-resolving live query and a legacy row with noteMode: null
 * (predates this field). The opposite default would run a real Core
 * Assessment through the light editor's shallow-merge upcast, and autosave
 * would then overwrite it with a blank session payload — see
 * domain/types.ts's NoteMode doc comment.
 */
export function NoteEditorDispatch() {
  const { noteId } = useParams({ strict: false }) as { noteId: string };
  const note = useLiveQuery(() => repos.consultationNotes.get(noteId), [noteId]);

  if (note?.noteMode === 'session') {
    return <SessionNoteEditorPage />;
  }
  return <NoteEditorPage />;
}
