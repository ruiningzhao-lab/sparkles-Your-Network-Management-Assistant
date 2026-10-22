import { bad, body, member, ok } from '@/lib/api';
import { cleanNote } from '@/lib/store/validate';

export const dynamic = 'force-dynamic';

export const GET = member(async ({ store }, req) => {
  const pid = new URL(req.url).searchParams.get('personId');
  const notes = await store.listNotes(pid ? 1000 : 300);
  return ok({ notes: pid ? notes.filter((n) => n.people.includes(pid)) : notes });
});

/** Create or update a native note linked to people on the map. */
export const POST = member(async ({ store }, req) => {
  const b = await body(req);
  const people = await store.listPeople();
  const note = cleanNote(b.note, new Set(people.map((p) => p.id)));
  if (!note) return bad('Write something to save a note.');
  if (!note.people.length) return bad('Link the note to someone on your map.');
  await store.saveNote(note);
  return ok({ note });
});

export const DELETE = member(async ({ store }, req) => {
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!id) return bad('Which note?');
  await store.deleteNote(id);
  return ok();
});
