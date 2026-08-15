# Al Shrooouk Scan & Lab — Unified Operations Platform

Private repository. Built per the BRD/PRD v1.0 and Execution Roadmap.

## Status: Phase 0 — Pre-Build Setup

- [x] Repo initialized
- [x] Supabase schema migrated (19 core tables, RLS enabled on all, policies pending Phase 1+)
- [ ] Vercel plan decision (Hobby vs Pro)
- [ ] Real exam/scan catalog confirmed
- [ ] Real branch list confirmed
- [ ] Patient portal login method confirmed (magic-link vs username/password)
- [ ] Rotated credentials confirmed

## Stack

- Next.js (Vercel)
- Supabase (Postgres 17, project ref `shsotkryegamrxulsjww`)
- Google Drive (service account: `elsherouk-drive-uploader@elsherouk-drive-integration.iam.gserviceaccount.com`)
- WhatsApp Click-to-Chat

See `/supabase/migrations` for the schema.
