alter table exam_types add column if not exists category text default 'misc' check (category in ('2d','3d','bundle','misc'));
alter table doctors add column if not exists special_note text;

update exam_types set category = '2d' where name in (
  '2D Panoramic + Ceph Image','Panoramic Adult Full Arch','Panoramic Adult Half Arch',
  'Panoramic Child Full Arch','Panoramic Sinus','Panoramic TMJ','Half Bite Wing 2D Panorama',
  'Periapical X-Ray','Ceph Image (2D Cephalometry)','Ceph Analysis (Tracing)',
  'Ceph Profile (Orthodontic Study)','Ceph Profile (Complete Orthodontic Study)'
);
update exam_types set category = '3d' where name in (
  '3D CBCT Both Arch','3D CBCT Endo Extra Tooth','3D CBCT Endo One Tooth','3D CBCT One Arch',
  '3D CBCT Quadrant','3D Sinus','3D TMJ Both Sides Open & Closed','3D TMJ Both Sides Open or Closed',
  '3D TMJ One Side Open & Closed','3D TMJ One Side Open or Closed','CBCT Cast Scan'
);
update exam_types set category = 'bundle' where name ilike 'Package:%';
update exam_types set category = 'misc' where name in ('CD/DVD','Dental Photography','Photo Analysis','Printing');
