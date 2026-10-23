-- A report can carry more than one file (asked for by Reham, 21 Oct 2026).
-- report_file_url / report_file_name stay as the first file so everything
-- that already reads them keeps working; report_files is the full list.
alter table public.reports add column if not exists report_files jsonb not null default '[]'::jsonb;

update public.reports
   set report_files = jsonb_build_array(jsonb_build_object(
         'name', report_file_name, 'url', report_file_url, 'uploaded_at', completed_at))
 where report_file_url is not null and report_files = '[]'::jsonb;
