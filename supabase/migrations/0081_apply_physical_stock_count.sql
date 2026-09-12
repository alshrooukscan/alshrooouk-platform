-- 0081: apply the physical stock count.
--
-- 119 of the 120 disputed dental items, counted on the shelf by the client's
-- team. Metal Crow was left blank and is deliberately untouched - a missing
-- number is not a zero.
--
-- This settles a disagreement the platform could not settle itself. Since the
-- migration, every sale moved stock_items.qty_remaining and nothing moved the
-- batch ledger, so the two records drifted apart and neither had been checked
-- against the shelf. The count is the only figure here anybody has actually
-- verified, so both records are set to it.
--
-- The shelf is far lower than the system believed: 2,185 units become 239, and
-- 341,575 EGP of assumed stock becomes 30,444. Most of that is not loss
-- discovered today - it is sales that were never deducted, going back to the
-- migration. retaction past voco reading 286 when 3 are on the shelf is 283
-- units sold and never taken off the count.
--
-- apply_stock_count sets the item and its batch ledger to the same figure, and
-- the trigger from 0062 keeps them together from here. Every previous value is
-- kept in stock_count_backup_0081.

create table if not exists stock_count_backup_0081 (
  stock_item_id uuid primary key,
  item_name text,
  qty_before numeric,
  ledger_before numeric,
  counted numeric,
  applied_at timestamptz not null default now()
);

create temp table counted_input (stock_item_id uuid primary key, counted numeric) on commit drop;
insert into counted_input (stock_item_id, counted) values
  ('4d548eae-4ecd-40b7-9d76-7c630cce6481'::uuid, 3),
  ('8b4daebd-ad6e-4d5c-bd19-033fd4b47901'::uuid, 8),
  ('d650d964-a289-491b-b907-bb4ca42cf81e'::uuid, 10),
  ('7fd97b70-8043-4daf-bab1-525c91177d23'::uuid, 14),
  ('18caef43-8b28-4b72-a1e7-0588aabb2ea9'::uuid, 5),
  ('624b789e-f3d8-4d3e-8860-0623e6b0c871'::uuid, 0),
  ('ae2a496d-06c2-4cc5-831c-7ba1330627f3'::uuid, 0),
  ('7d91f2b4-13fc-4637-85f5-f6add18bab69'::uuid, 5),
  ('3050aa09-b265-4fa5-8134-9628f63131a9'::uuid, 3),
  ('ad20d2cd-d780-41c9-b556-087e14ab249a'::uuid, 8),
  ('a576c888-1ea3-4928-b1bb-659a0d5d3625'::uuid, 5),
  ('8feb484e-e5ed-43c1-95e7-7572c15878bc'::uuid, 5),
  ('1914fc3a-b1f4-46e5-ac4e-46b967a9db72'::uuid, 4),
  ('2a008141-ace1-483d-8516-389b4fbccc95'::uuid, 4),
  ('c32fbfc7-d186-4d15-af5d-f05244661a96'::uuid, 0),
  ('fb69f676-c2a8-464d-aeba-e688c1c9eb5b'::uuid, 0),
  ('5470df9e-a90b-45a8-b211-47262355680b'::uuid, 1),
  ('e26180e6-bd55-47d2-af78-671d8e94575b'::uuid, 4),
  ('9aa0bff3-5e5d-4598-8864-f72a1232bda3'::uuid, 4),
  ('3a7bbc61-2b38-4c4b-a941-e666f2ec0df3'::uuid, 2),
  ('e523b6a1-c4f9-4e9e-aa4a-98fc5ce9c90f'::uuid, 3),
  ('7146656f-5f8a-48de-8f94-c370a171d14a'::uuid, 1),
  ('aa3a078e-4f60-4137-a2f0-a1e6b2e9563d'::uuid, 3),
  ('6fe41f2c-2370-42fc-8972-5bd5bfac57b9'::uuid, 18),
  ('66be5728-9e06-4179-b012-29bf62d53581'::uuid, 2),
  ('dda85b76-218e-4f3f-88fa-09cec0f6d43b'::uuid, 5),
  ('4f8849e3-d09f-40a5-94fd-7d3557cede64'::uuid, 1),
  ('e41b8d74-b28d-4bf8-b25d-912cdf86233b'::uuid, 1),
  ('640ba445-e746-49ca-98b3-f2f5d14c98da'::uuid, 4),
  ('83969be3-4ae2-4e93-9514-5f116411cba9'::uuid, 3),
  ('a91c36a8-49a3-48c4-8d84-a7cbc8d3de09'::uuid, 1),
  ('9999e28c-8d22-4b2e-8e7d-5fed3bbda4fc'::uuid, 2),
  ('64242c33-1efb-41dc-b83b-7055b0bccee4'::uuid, 14),
  ('63e8d1a3-2c0a-4bb9-bbd9-8e941f3fd6d5'::uuid, 1),
  ('72efe52f-c1b7-4fcf-b918-83cedb838c78'::uuid, 0),
  ('a00a3061-9c87-4130-8cb2-d5f0021cc808'::uuid, 1),
  ('9cd7cd84-db69-4878-beb6-fc0cef9632b4'::uuid, 1),
  ('b9c75e95-0112-4d04-bad3-bd4cbbd54bd5'::uuid, 11),
  ('93a59a65-afe1-4df9-9ff6-3bc91d44eb94'::uuid, 1),
  ('85854fbf-1072-482f-85c9-d0b064ceb648'::uuid, 1),
  ('d45f7d53-23a0-43a5-950f-fa3ab2e29aec'::uuid, 2),
  ('b36b232f-183d-4536-b337-5772733dadb1'::uuid, 3),
  ('a6ff53d8-0e23-47af-bda8-4908a056c27a'::uuid, 3),
  ('e2bfcc73-3c77-44a0-a42d-cb7fd6f99727'::uuid, 0),
  ('40ea750e-fc55-43c4-8032-772af30f900a'::uuid, 1),
  ('c514d4c3-5fbf-4b21-9a67-0726c1cf9bfd'::uuid, 0),
  ('399c9ac9-38e9-440c-b246-697c80439593'::uuid, 3),
  ('f44629d5-7ca3-4859-9616-cab0e6de60ed'::uuid, 1),
  ('772d02e7-71a3-4718-860b-a8995f88db09'::uuid, 0),
  ('acba3b85-dba6-4324-908d-2e48164abf8c'::uuid, 8),
  ('ac11ecdf-8ba8-4071-9744-120bf623a95c'::uuid, 1),
  ('3684fac9-4ca8-4734-b97b-16cbd88ab13e'::uuid, 1),
  ('aa9d77cb-fda6-462a-865b-ddb90c3a4dbc'::uuid, 0),
  ('7d7da737-8895-4d91-b21c-5599e78ab64c'::uuid, 0),
  ('828965a1-df20-4211-b0ba-fe070ffa85f3'::uuid, 1),
  ('83391f42-4820-4521-95c7-bf28cd510ec1'::uuid, 1),
  ('d2ac9b14-7882-4e69-a07e-0d79d7df4d30'::uuid, 0),
  ('46b7502c-5bdb-410b-89ce-bade8e2a6962'::uuid, 0),
  ('bbd2211c-5220-4355-84ae-d7aaa9fad9f8'::uuid, 7),
  ('0cef4494-2f39-4581-b57b-ac573cdcc2c0'::uuid, 0),
  ('a54d6c8d-3c39-4f74-a353-c0bc09f45137'::uuid, 3),
  ('8e2e62a2-57ff-45c7-94e2-a4c429f811a1'::uuid, 2),
  ('6ee4ad23-c663-4da7-a059-b2fe6ffdf4f5'::uuid, 3),
  ('9333c698-3835-4fd5-85e6-d05473d44976'::uuid, 3),
  ('79fcebeb-cb02-4540-a336-89319fd10a14'::uuid, 1),
  ('69e10701-2565-453b-a0e3-ba89b7376c58'::uuid, 0),
  ('1b08b759-c51e-4724-9a2b-6668204f18ac'::uuid, 3),
  ('fce51740-f7f8-4bb7-8ef5-65cef6896dde'::uuid, 0),
  ('22394991-7338-450d-8e07-8b1907fd758f'::uuid, 2),
  ('a3d3001e-db49-49ef-82a0-21bfa472cc64'::uuid, 1),
  ('1dd71db7-4697-4d6f-aeda-f9380bc85a1f'::uuid, 0),
  ('d663a6f1-0d10-4da3-92b2-02b71e56a19d'::uuid, 0),
  ('84546ec7-1400-4752-acc8-7b48030996aa'::uuid, 1),
  ('ebefd883-436f-462e-a2d2-63cf18135e00'::uuid, 0),
  ('cfc19161-4b47-4767-9ccf-b0a60f10518d'::uuid, 1),
  ('c7d6bbb4-ddf0-4f54-8e6e-abc36376c221'::uuid, 2),
  ('d683d5a3-2e3e-478b-9d35-291263a002d5'::uuid, 2),
  ('36e07444-80ee-4329-9b82-3d80344f2cfb'::uuid, 0),
  ('63e69a82-f502-48cd-b497-48b81a67a7e8'::uuid, 2),
  ('73303eb7-0625-4852-844d-02b19faecf6a'::uuid, 1),
  ('fdd4ede5-2084-4a59-835e-226145ebba81'::uuid, 0),
  ('07928cba-7bc7-4ceb-a82e-26e4dbbec485'::uuid, 1),
  ('09c9abec-f7d3-4bad-9b53-8b6f94f51be9'::uuid, 0),
  ('16bb1a8c-e1fe-458e-8b61-782c95125048'::uuid, 1),
  ('1882b0a9-27f3-400d-b115-5a3eb319a596'::uuid, 0),
  ('23dba30a-80b6-4c17-be17-3bddc4b7f74c'::uuid, 2),
  ('452690e4-a714-47d0-a4ce-806e4228a93e'::uuid, 1),
  ('4b39c70d-9588-4f61-9862-12dfee40a857'::uuid, 1),
  ('4ddbd0cc-8d4a-4224-a342-96b7fdc7ed64'::uuid, 1),
  ('5284328c-f553-483d-9a09-ba29bb9be531'::uuid, 0),
  ('58c9948f-f675-47a7-ab79-997a89071e2e'::uuid, 0),
  ('6028e082-7159-487f-924b-2584b02f40f4'::uuid, 1),
  ('60acd390-b291-496c-861a-03f15a5f4439'::uuid, 1),
  ('647406e6-9b2f-4f09-a1ce-6f19b7f34f33'::uuid, 1),
  ('6c5cf264-7770-4988-a174-eb82e8d41076'::uuid, 1),
  ('70906c37-889e-4613-b2e3-9a93d38e9f8f'::uuid, 0),
  ('741cfbf4-07a0-4395-b80c-5cbb1181f99d'::uuid, 0),
  ('7536ff10-fe37-4cc2-b1a6-7edeb327a67d'::uuid, 0),
  ('766d6a7e-6e9d-4f42-991c-818b2c88d985'::uuid, 1),
  ('820500e0-93d6-4f78-8b78-a5eddccdc7ca'::uuid, 0),
  ('890cd627-17e3-49dc-a606-76b78591a975'::uuid, 0),
  ('8c9f253e-e579-4101-8d1d-64d829397fe1'::uuid, 0),
  ('984e374f-ba0e-4f9a-aea4-18ac182d804d'::uuid, 0),
  ('a1fbedc5-c15d-4294-9ac6-3ad9e9097ffc'::uuid, 0),
  ('a76479d6-ff61-4f45-bed5-b12bc3ef1570'::uuid, 1),
  ('aac6f835-0a61-4890-8449-40e89131a0e8'::uuid, 0),
  ('add9ad65-c33c-4679-8fd4-0ab1fd34d034'::uuid, 0),
  ('ae5b2365-cda9-4ef2-b998-0c89257c1e31'::uuid, 0),
  ('b0ebb2ec-b1d8-4187-9e91-8501e4fd2399'::uuid, 2),
  ('b1d9484b-d85b-41e1-b133-7e1cd62eb8d6'::uuid, 1),
  ('b5b91880-4ac0-41ff-aa39-3fba82d4d418'::uuid, 1),
  ('b668577a-769e-40b3-81e5-ce63043e42c8'::uuid, 0),
  ('c215519c-5b04-42d7-8b8b-6f303995db6c'::uuid, 0),
  ('cc390297-072e-498a-be4b-cb931545a69f'::uuid, 0),
  ('cc565dcc-24ec-4352-87f8-c83a72055f79'::uuid, 0),
  ('cec45a14-c1b3-4dd8-9c73-44afa11a2224'::uuid, 0),
  ('d4c3bc97-422b-49f2-a2aa-80b0e2851162'::uuid, 1),
  ('ec31bd0a-ac08-4160-8615-bd3bb545fa7d'::uuid, 1),
  ('0264e43a-d3fe-4942-8f14-ce48ccf6bcee'::uuid, 2);

insert into stock_count_backup_0081 (stock_item_id, item_name, qty_before, ledger_before, counted)
select si.id, si.name, si.qty_remaining,
       coalesce((select sum(b.qty_remaining) from stock_batches b where b.stock_item_id = si.id), 0),
       ci.counted
from counted_input ci join stock_items si on si.id = ci.stock_item_id
on conflict (stock_item_id) do nothing;

do $$
declare r record;
begin
  for r in select * from counted_input loop
    perform apply_stock_count(r.stock_item_id, r.counted, 'Physical count, September 2026');
  end loop;
end $$;
