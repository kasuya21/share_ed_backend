-- Run once in the Supabase SQL editor for the project used by SHARE-ED.
-- The bucket remains private; uploads and downloads use short-lived signed URLs.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'post-pdfs',
  'post-pdfs',
  false,
  20971520,
  array['application/pdf']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
