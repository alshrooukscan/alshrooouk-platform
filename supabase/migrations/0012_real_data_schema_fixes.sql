-- Real data reveals: mobile numbers are sometimes shared across family members,
-- and Clinic Code alone isn't guaranteed unique (12 collisions in real data).
-- The true unique identifier doctors already use is the compound "Unique Code" (ClinicCode_Name).

alter table patients drop constraint if exists patients_mobile_key;
create index if not exists idx_patients_mobile on patients(mobile);

alter table doctors drop constraint if exists doctors_clinic_code_key;
alter table doctors add column if not exists unique_code text unique;
create index if not exists idx_doctors_clinic_code on doctors(clinic_code);
