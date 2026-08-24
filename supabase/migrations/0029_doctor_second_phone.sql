-- A number of doctor records had two phone numbers combined into one field
-- (e.g. "01046737233&01553077233"). Splitting into two real fields so both
-- are searchable and neither is at risk of being silently dropped or corrupted.
alter table doctors add column if not exists phone_2 text;
