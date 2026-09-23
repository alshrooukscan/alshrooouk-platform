# shscan.com CBCT gateway

Runs at the clinic, on the same local network as the Xline XDI-350's acquisition PC. It bridges the machine's DICOM interface to shscan.com over the internet, with nothing reachable inbound - see section 2 of the development plan doc for why.

Two pieces, both in this folder:

- **Orthanc** (`orthanc/`) - the local DICOM server the XDI-350 talks to.
- **sync-agent** (`sync-agent/`) - the only thing that talks to shscan.com. Pushes worklist entries before a scan, relays finished studies after one.

## Before install: confirm the DICOM licence

Do not install any of this until the client confirms with their equipment dealer that the XDI-350's software has DICOM Store and Worklist enabled (may be a separately licensed "Dicom extension" - see section 7 of the development plan). Installing the gateway with no licence on the machine side means nothing will ever connect to it.

## Setup

1. Edit `orthanc/orthanc.json`: set a real `RegisteredUsers` password (replace `CHANGE_ME_STRONG_SECRET`), and once the XDI-350's real calling AE Title is known from commissioning (section 6 of the plan), fill it into `DicomModalities` and flip the three `DicomAlwaysAllow*` settings to `false`.
2. From the main shscan.com repo (needs `SUPABASE_SERVICE_ROLE_KEY`), run:
   ```
   node scripts/gateway_issue_key.js "Nasr City clinic gateway"
   ```
   Copy the printed key - it is shown once.
3. Edit `docker-compose.yml`: match the `ORTHANC_PASSWORD` to step 1, and set `GATEWAY_API_KEY` to the key from step 2.
4. From this `gateway/` folder:
   ```
   docker compose up -d
   ```
5. On the XDI-350's acquisition PC (OrisWin or X-Light), open the DICOM settings and point both the Worklist server and the PACS/Store destination at this PC's IP, port `4242`, AE Title `SHSCAN`. Press Verify.
6. Run the commissioning script in section 6 of the development plan before relying on this for real patients.

## What each service does

- `orthanc`: receives the finished scan (DICOM C-STORE) and serves the worklist (DICOM C-FIND) the machine queries before a scan.
- `sync-agent`: polls shscan.com every 30s for visits needing a worklist entry and creates them in Orthanc; watches Orthanc every 15s for a study that has finished arriving (`StableStudy`) and relays it to shscan.com, which files it to the matched patient's Drive folder or, if nothing matched, into the review queue at `/dashboard/settings/unmatched-scans`.

## Logs

`docker compose logs -f sync-agent` - every worklist push and every study relay prints a line. The same events also land in `gateway_sync_log` on the Supabase side, visible from the dashboard for support.
