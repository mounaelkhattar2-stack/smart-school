-- Private parent absence documents. File paths begin with the authenticated parent UUID.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('absence-documents','absence-documents',false,2097152,array['application/pdf','image/png','image/jpeg'])
on conflict (id) do update set public=false,file_size_limit=2097152,allowed_mime_types=array['application/pdf','image/png','image/jpeg'];

create policy "Parents upload own absence documents" on storage.objects
for insert to authenticated with check (
  bucket_id='absence-documents'
  and (storage.foldername(name))[1]=auth.uid()::text
  and exists (
    select 1 from public.absence_explanations e
    join public.students s on s.student_id=e.student_id
    join public.profiles p on p.id=auth.uid() and p.role='PARENT' and p.student_id=s.student_id
    where e.explanation_id=(storage.foldername(name))[2]
      and e.submitted_by=auth.uid() and e.status='EN_ATTENTE'
  )
);
create policy "Parents and Direction read linked absence documents" on storage.objects
for select to authenticated using (
  bucket_id='absence-documents' and (
    (storage.foldername(name))[1]=auth.uid()::text
    or exists (
      select 1 from public.absence_explanation_documents d
      join public.absence_explanations e on e.explanation_id=d.explanation_id
      where d.storage_key=name and (select private.is_direction())
    )
  )
);
create policy "Parents delete own pending absence documents" on storage.objects
for delete to authenticated using (
  bucket_id='absence-documents'
  and (storage.foldername(name))[1]=auth.uid()::text
  and exists (
    select 1 from public.absence_explanation_documents d
    join public.absence_explanations e on e.explanation_id=d.explanation_id
    where d.storage_key=name and d.uploaded_by=auth.uid() and e.status='EN_ATTENTE'
  )
);

create policy "Parents register own absence document metadata" on public.absence_explanation_documents
for insert to authenticated with check (
  uploaded_by=auth.uid()
  and exists (
    select 1 from public.absence_explanations e
    where e.explanation_id=absence_explanation_documents.explanation_id
      and e.submitted_by=auth.uid() and e.status='EN_ATTENTE'
      and (select private.is_parent_of(e.student_id))
  )
);
