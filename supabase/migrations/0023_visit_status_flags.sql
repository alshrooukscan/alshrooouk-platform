alter table visits add column if not exists scanned boolean not null default false;
alter table visits add column if not exists raw_data_uploaded boolean not null default false;
alter table visits add column if not exists report_done boolean not null default false;
