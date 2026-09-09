-- After the workbook import the catalogue held two coding schemes side by side:
-- 167 dental items on the plain numbers the import issued, 82 still on the old
-- DEN-xx codes they were created with, and 59 El3awama items on a third. Two of
-- the plain numbers had also collided, because a number the import issued
-- already belonged to an item that was live before it.
--
-- Every item in a stock now gets a plain number, 1 to the end of that stock's
-- list, ordered by name so variants stay beside each other - the same ordering
-- the client reviewed the codes in.
--
-- Two stocks, two independent sequences. They are separate lists on separate
-- tabs, and one shared sequence would leave each with gaps it could not
-- explain. item_code is display-only everywhere in the app - nothing joins or
-- looks up on it - so renumbering moves no data.
with ranked as (
  select id, row_number() over (partition by category order by name) as rn
  from stock_items
)
update stock_items s
   set item_code = r.rn::text
  from ranked r
 where r.id = s.id;
