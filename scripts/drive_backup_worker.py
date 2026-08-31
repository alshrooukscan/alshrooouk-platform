import os, sys, json, time, threading, requests
from concurrent.futures import ThreadPoolExecutor
from google.oauth2 import service_account
import google.auth.transport.requests

SB = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1"
SVC = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": SVC, "Authorization": f"Bearer {SVC}", "Content-Type": "application/json"}
RUN = int(os.environ.get("RUN_SECONDS", "3000"))
WORKERS = int(os.environ.get("WORKERS", "8"))
DEADLINE = time.time() + RUN

creds = service_account.Credentials.from_service_account_info(
    json.loads(os.environ["GOOGLE_SERVICE_ACCOUNT_KEY"]),
    scopes=["https://www.googleapis.com/auth/drive"])
creds.refresh(google.auth.transport.requests.Request())
_tok = {"t": creds.token, "at": time.time()}
_lk = threading.Lock()
def tok():
    with _lk:
        if time.time() - _tok["at"] > 2400:
            creds.refresh(google.auth.transport.requests.Request())
            _tok.update(t=creds.token, at=time.time())
        return _tok["t"]

tls = threading.local()
def S():
    if not hasattr(tls, "s"): tls.s = requests.Session()
    return tls.s

def setting(k, d=None):
    r = requests.get(f"{SB}/drive_backup_settings", headers=H,
                     params={"select": "value", "key": f"eq.{k}"}, timeout=60).json()
    return r[0]["value"] if r else d

def page(params):
    out, off = [], 0
    while True:
        p = dict(params); p.update({"limit": 1000, "offset": off, "order": "id"})
        b = requests.get(f"{SB}/drive_backup_map", headers=H, params=p, timeout=120).json()
        if not isinstance(b, list) or not b: break
        out.extend(b); off += len(b)
        if len(b) < 1000: break
    return out

def flush(rows):
    for i in range(0, len(rows), 200):
        requests.post(f"{SB}/drive_backup_map?on_conflict=source_id",
            headers={**H, "Prefer": "resolution=merge-duplicates,return=minimal"},
            json=rows[i:i+200], timeout=90)

if str(setting("enabled", "false")) != "true":
    print("PAUSED via kill switch — exiting"); sys.exit(0)
BK = setting("backup_root_id")
if not BK: print("no backup_root_id"); sys.exit(1)

def mkfolder(name, parent):
    for a in range(4):
        r = S().post("https://www.googleapis.com/drive/v3/files",
            headers={"Authorization": f"Bearer {tok()}", "Content-Type": "application/json"},
            params={"supportsAllDrives": "true", "fields": "id"},
            json={"name": name, "mimeType": "application/vnd.google-apps.folder", "parents": [parent]},
            timeout=90)
        if r.status_code < 300: return r.json()["id"], None
        if r.status_code in (403, 429, 500, 503): time.sleep(2 * (a + 1)); continue
        return None, f"{r.status_code}:{r.text[:100]}"
    return None, "retries"

def cpfile(fid, name, parent):
    for a in range(4):
        r = S().post(f"https://www.googleapis.com/drive/v3/files/{fid}/copy",
            headers={"Authorization": f"Bearer {tok()}", "Content-Type": "application/json"},
            params={"supportsAllDrives": "true", "fields": "id"},
            json={"name": name, "parents": [parent]}, timeout=600)
        if r.status_code < 300: return r.json()["id"], None
        if r.status_code in (403, 429, 500, 503, 504): time.sleep(3 * (a + 1)); continue
        return None, f"{r.status_code}:{r.text[:100]}"
    return None, "retries"

def leaf(p): return (p or "/").rstrip("/").split("/")[-1] or "unnamed"

# ---------- PHASE 1: folder tree ----------
rows = page({"select": "source_id,source_path,parent_source_id,backup_id,status,depth", "is_folder": "is.true"})
byid = {r["source_id"] for r in rows}
done = {r["source_id"]: r["backup_id"] for r in rows if r["status"] == "done" and r["backup_id"]}
pend = sorted([r for r in rows if r["status"] != "done"], key=lambda r: r.get("depth") or 1)
print(f"folders: {len(rows)} done={len(done)} pending={len(pend)}", flush=True)
created = 0
while pend and time.time() < DEADLINE:
    ready, nxt = [], []
    for r in pend:
        ps = r["parent_source_id"]
        t = BK if (not ps or ps not in byid) else done.get(ps)
        (ready.append((r, t)) if t else nxt.append(r))
    if not ready: pend = nxt; break
    buf = []
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for r, res in ex.map(lambda a: (a[0], mkfolder(leaf(a[0]["source_path"]), a[1])), ready):
            nid, err = res
            if nid:
                done[r["source_id"]] = nid; created += 1
                buf.append({"source_id": r["source_id"], "backup_id": nid, "is_folder": True, "status": "done", "copied_at": __import__("datetime").datetime.utcnow().isoformat()+"Z"})
                if len(buf) >= 100: flush(buf); buf = []
            else: nxt.append(r)
    if buf: flush(buf)
    pend = nxt
    print(f"  folders created={created} remaining={len(pend)}", flush=True)
print(f"PHASE1 done created={created}", flush=True)

# ---------- PHASE 2: files ----------
copied = 0; total_b = 0
while time.time() < DEADLINE:
    batch = requests.get(f"{SB}/drive_backup_map", headers=H, timeout=90, params={
        "select": "source_id,source_path,parent_source_id,size_bytes",
        "is_folder": "is.false", "status": "eq.pending", "limit": 60, "order": "size_bytes.asc"}).json()
    if not isinstance(batch, list) or not batch:
        print("ALL FILES DONE", flush=True); break
    jobs = []
    for it in batch:
        t = done.get(it["parent_source_id"])
        if not t:
            p = requests.get(f"{SB}/drive_backup_map", headers=H, timeout=60,
                params={"select": "backup_id", "source_id": f"eq.{it['parent_source_id']}"}).json()
            t = p[0]["backup_id"] if p and p[0].get("backup_id") else None
            if t: done[it["parent_source_id"]] = t
        if t: jobs.append((it, t))
    if not jobs:
        print("no ready parents; stopping", flush=True); break
    buf = []
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for it, res in ex.map(lambda a: (a[0], cpfile(a[0]["source_id"], leaf(a[0]["source_path"]), a[1])), jobs):
            nid, err = res
            if nid:
                copied += 1; total_b += int(it.get("size_bytes") or 0)
                buf.append({"source_id": it["source_id"], "backup_id": nid, "is_folder": False, "status": "done", "copied_at": __import__("datetime").datetime.utcnow().isoformat()+"Z"})
            else:
                buf.append({"source_id": it["source_id"], "is_folder": False, "status": "pending", "err": (err or "")[:150]})
    flush(buf)
    print(f"  copied={copied} gb={total_b/1024**3:.2f}", flush=True)
print(f"PHASE2 copied={copied} gb={total_b/1024**3:.2f}", flush=True)
