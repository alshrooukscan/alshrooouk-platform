import os, sys, json, time, threading, requests
from concurrent.futures import ThreadPoolExecutor
from google.oauth2 import service_account
import google.auth.transport.requests

SB = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1"
SVC = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": SVC, "Authorization": f"Bearer {SVC}", "Content-Type": "application/json"}
RUN = int(os.environ.get("RUN_SECONDS", "3000"))
WORKERS = int(os.environ.get("WORKERS", "4"))  # conservative - this mutates live data, not just copies
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

def GH(): return {"Authorization": f"Bearer {tok()}"}

def setting(k, d=None):
    r = requests.get(f"{SB}/drive_reorg_settings", headers=H, params={"select": "value", "key": f"eq.{k}"}, timeout=30).json()
    return r[0]["value"] if r else d

if str(setting("enabled", "false")) != "true":
    print("PAUSED via kill switch - exiting"); sys.exit(0)

def api_get(url, params, tries=4):
    for a in range(tries):
        r = S().get(url, headers=GH(), params=params, timeout=60)
        if r.status_code < 300: return r
        if r.status_code in (403, 429, 500, 503): time.sleep(2 * (a + 1)); continue
        return r
    return r

def api_patch(url, params, body, tries=4):
    for a in range(tries):
        r = S().patch(url, headers={**GH(), "Content-Type": "application/json"}, params=params, json=body, timeout=60)
        if r.status_code < 300: return r
        if r.status_code in (403, 429, 500, 503): time.sleep(2 * (a + 1)); continue
        return r
    return r

def api_post(url, params, body, tries=4):
    for a in range(tries):
        r = S().post(url, headers={**GH(), "Content-Type": "application/json"}, params=params, json=body, timeout=60)
        if r.status_code < 300: return r
        if r.status_code in (403, 429, 500, 503): time.sleep(2 * (a + 1)); continue
        return r
    return r

def process_one(row):
    pid = row["patient_id"]
    folder_id = row["drive_folder_id"]
    current_name = row["current_name"]
    pid_short = pid[:8]
    vid_short = row["visit_id"][:8]
    target_name = f"{current_name}__{pid_short}"
    subfolder_name = f"{row['exam_date']}__{vid_short}"

    try:
        meta = api_get(f"https://www.googleapis.com/drive/v3/files/{folder_id}",
            {"fields": "id,name", "supportsAllDrives": "true"})
        if meta.status_code >= 300:
            return {"patient_id": pid, "status": "error", "err": f"folder lookup failed: {meta.status_code}"}
        real_name = meta.json()["name"]

        already_renamed = real_name == target_name
        # Safety guard: if the folder's real name is neither the expected
        # original name NOR our own target pattern, something unexpected
        # touched it since the match was computed - don't guess, flag it.
        if not already_renamed and real_name.strip() != current_name.strip():
            return {"patient_id": pid, "status": "needs_review",
                    "err": f"unexpected folder name '{real_name}' (expected '{current_name}' or already-migrated '{target_name}')"}

        if not already_renamed:
            r = api_patch(f"https://www.googleapis.com/drive/v3/files/{folder_id}",
                {"supportsAllDrives": "true"}, {"name": target_name})
            if r.status_code >= 300:
                return {"patient_id": pid, "status": "error", "err": f"rename failed: {r.status_code}"}

        kids = api_get("https://www.googleapis.com/drive/v3/files", {
            "q": f"'{folder_id}' in parents and trashed=false",
            "fields": "files(id,name,mimeType)", "supportsAllDrives": "true", "includeItemsFromAllDrives": "true"})
        children = kids.json().get("files", [])
        existing_sub = next((c for c in children if c["mimeType"] == "application/vnd.google-apps.folder" and c["name"] == subfolder_name), None)
        loose_files = [c for c in children if c["mimeType"] != "application/vnd.google-apps.folder"]

        if existing_sub:
            subfolder_id = existing_sub["id"]  # idempotent resume - reuse, don't duplicate
        else:
            r2 = api_post("https://www.googleapis.com/drive/v3/files", {"supportsAllDrives": "true", "fields": "id"},
                {"name": subfolder_name, "mimeType": "application/vnd.google-apps.folder", "parents": [folder_id]})
            if r2.status_code >= 300:
                return {"patient_id": pid, "status": "error", "err": f"subfolder create failed: {r2.status_code}"}
            subfolder_id = r2.json()["id"]

        moved = 0
        for f in loose_files:
            r3 = api_patch(f"https://www.googleapis.com/drive/v3/files/{f['id']}",
                {"addParents": subfolder_id, "removeParents": folder_id, "supportsAllDrives": "true"}, {})
            if r3.status_code < 300: moved += 1

        return {"patient_id": pid, "status": "done", "visit_subfolder_id": subfolder_id, "files_moved": moved}
    except Exception as e:
        return {"patient_id": pid, "status": "error", "err": str(e)[:200]}

def flush(results):
    for r in results:
        body = {k: v for k, v in r.items() if k != "patient_id"}
        body["processed_at"] = "now()" if r["status"] == "done" else None
        requests.patch(f"{SB}/drive_reorg_queue?patient_id=eq.{r['patient_id']}",
            headers={**H, "Prefer": "return=minimal"}, json=body, timeout=30)

done_ct = err_ct = review_ct = 0
while time.time() < DEADLINE:
    batch = requests.get(f"{SB}/drive_reorg_queue", headers=H, timeout=30, params={
        "select": "patient_id,drive_folder_id,current_name,visit_id,exam_date",
        "status": "eq.pending", "limit": 20}).json()
    if not batch:
        print("QUEUE_EMPTY"); break
    requests.patch(f"{SB}/drive_reorg_queue?patient_id=in.({','.join(b['patient_id'] for b in batch)})",
        headers={**H, "Prefer": "return=minimal"}, json={"status": "processing"}, timeout=30)
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        results = list(ex.map(process_one, batch))
    flush(results)
    for r in results:
        if r["status"] == "done": done_ct += 1
        elif r["status"] == "needs_review": review_ct += 1
        else: err_ct += 1
    print(f"done={done_ct} needs_review={review_ct} errors={err_ct}", flush=True)

print(f"FINAL done={done_ct} needs_review={review_ct} errors={err_ct}")
