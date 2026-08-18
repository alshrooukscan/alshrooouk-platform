alter table employees add column if not exists permissions jsonb not null default '{"dashboard":false,"patients":false,"doctors":false,"stock":false,"hr":false,"settings":false}'::jsonb;
alter table employees add column if not exists staff_account_email text;
