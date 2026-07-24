-- Consultation notes: one note documents one visit (decision recorded in
-- the v1 spec brief). visits.consultation_note_id already points the other
-- way for the "which visit does this note cover" lookup from the visit
-- side; this column is the inverse FK so the note itself knows its visit
-- without a join, and so a patient's undocumented visits can be queried
-- directly (clinical_status = 'pending' and not exists a note with this
-- visit_id).
alter table public.consultation_notes
  add column visit_id uuid references public.visits (id);

create index consultation_notes_visit_idx on public.consultation_notes (visit_id);
