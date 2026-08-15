# Al Shrooouk Scan & Lab — Unified Operations Platform

Private repository. Built per the BRD/PRD v1.0 and Execution Roadmap.

## Status: Phase 0 — COMPLETE

- [x] Repo initialized
- [x] Supabase schema migrated (19 core tables, RLS enabled on all, policies pending Phase 1+)
- [x] First deployment live: https://alshrooouk-platform-al-shroouk-scan-lab.vercel.app
- [x] Vercel plan: Free (Hobby)
- [x] Real exam/scan catalog seeded (28 exam types, EGP pricing)
- [x] Real branch seeded: Medical Center 3 (active); admin can add more via Settings > Branches
- [x] Patient & Doctor portal login method confirmed: admin-generated username/password, delivered via the existing WhatsApp Click-to-Chat customer message
- [ ] Rotate the older exposed keys (standing item, independent of build progress)

## Stack

- Next.js (Vercel)
- Supabase (Postgres 17, project ref `shsotkryegamrxulsjww`)
- Google Drive (service account: `elsherouk-drive-uploader@elsherouk-drive-integration.iam.gserviceaccount.com`)
- WhatsApp Click-to-Chat

See `/supabase/migrations` for schema history.

## Next: Phase 1 — Core Data Spine

Patient/doctor search, registration, WhatsApp message generation, invoice generation.
