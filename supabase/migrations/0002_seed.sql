-- Phase 0: seed real exam catalog + branch + doctor portal auth columns

alter table doctors add column if not exists username text unique;
alter table doctors add column if not exists password_hash text;

insert into branches (name, is_active) values ('Medical Center 3', true)
on conflict do nothing;

insert into exam_types (name, price, is_active) values
('Panoramic Adult Full Arch', 600, true),
('Panoramic Adult Half Arch', 425, true),
('Panoramic Child Full Arch', 600, true),
('Panoramic Sinus', 750, true),
('Panoramic TMJ', 900, true),
('Ceph Image (2D Cephalometry)', 700, true),
('Ceph Profile (Orthodontic Study)', 1900, true),
('Ceph Profile (Complete Orthodontic Study)', 2500, true),
('Ceph Analysis (Tracing)', 300, true),
('3D CBCT Both Arch', 1950, true),
('3D CBCT One Arch', 1450, true),
('3D CBCT Quadrant', 1100, true),
('3D Sinus', 1850, true),
('3D TMJ Both Sides Open & Closed', 3000, true),
('3D TMJ Both Sides Open or Closed', 2200, true),
('3D TMJ One Side Open or Closed', 1850, true),
('3D TMJ One Side Open & Closed', 2200, true),
('3D CBCT Endo One Tooth', 850, true),
('3D CBCT Endo Extra Tooth', 100, true),
('Half Bite Wing 2D Panorama', 400, true),
('Package: CBCT + 2 Panoramic Adult Full Arch', 2500, true),
('2D Panoramic + Ceph Image', 1200, true),
('Periapical X-Ray', null, false),
('Printing', 75, true),
('CD/DVD', 75, true),
('Dental Photography', 800, true),
('Photo Analysis', 300, true),
('CBCT Cast Scan', 1450, true)
on conflict do nothing;
