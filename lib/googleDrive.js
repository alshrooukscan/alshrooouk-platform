import { google } from "googleapis";
import { Readable } from "stream";

let driveClient = null;

function getDriveClient() {
  if (driveClient) return driveClient;
  const key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const auth = new google.auth.GoogleAuth({
    credentials: key,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  driveClient = google.drive({ version: "v3", auth });
  return driveClient;
}

export async function findOrCreateFolder(name, parentId) {
  const drive = getDriveClient();
  const safeName = name.replace(/'/g, "\\'");
  const q = `name='${safeName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await drive.files.list({
    q,
    fields: "files(id,name)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  if (res.data.files && res.data.files.length > 0) return res.data.files[0].id;

  const createRes = await drive.files.create({
    requestBody: { name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] },
    fields: "id",
    supportsAllDrives: true,
  });
  return createRes.data.id;
}

export async function uploadFile(folderId, filename, mimeType, buffer) {
  const drive = getDriveClient();
  const res = await drive.files.create({
    requestBody: { name: filename, parents: [folderId] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: "id,name,mimeType,webViewLink,createdTime",
    supportsAllDrives: true,
  });
  return res.data;
}

export async function getFileParents(fileId) {
  const drive = getDriveClient();
  const res = await drive.files.get({
    fileId,
    fields: "parents",
    supportsAllDrives: true,
  });
  return res.data.parents || [];
}

export async function listFiles(folderId) {
  const drive = getDriveClient();
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: "files(id,name,mimeType,createdTime,webViewLink)",
    orderBy: "createdTime desc",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return res.data.files || [];
}

const FOLDER_MIME = "application/vnd.google-apps.folder";

// Patient folders come in three shapes and all of them must list:
//   1. loose files straight in the patient folder      (never reorganized)
//   2. patientFolder/<visit>/file                      (older reorganized layout)
//   3. patientFolder/Visit_<date>_<type>/Raw_DICOM/file (current upload layout)
//
// This used to descend ONE level, which was correct for shapes 1 and 2 but
// silently hid every file uploaded in shape 3 - the Raw_DICOM/Reports/Exports
// level was added to the upload path without widening the walk, so new uploads
// landed correctly in Drive and then never appeared on the patient's page.
export async function listFilesGrouped(folderId) {
  const direct = await listFiles(folderId);
  const looseFiles = direct.filter((f) => f.mimeType !== FOLDER_MIME).map((f) => ({ ...f, groupLabel: null }));
  const subfolders = direct.filter((f) => f.mimeType === FOLDER_MIME);

  const nested = await Promise.all(
    subfolders.map(async (sf) => {
      const kids = await listFiles(sf.id);
      // Files sitting directly in the visit folder.
      const here = kids.filter((f) => f.mimeType !== FOLDER_MIME).map((f) => ({ ...f, groupLabel: sf.name }));

      // ...and one level deeper, inside Raw_DICOM / Reports / Exports. They are
      // still labelled with the VISIT folder name so the UI groups them under
      // the visit, with the type folder kept alongside for display.
      const typeFolders = kids.filter((f) => f.mimeType === FOLDER_MIME);
      const deeper = await Promise.all(
        typeFolders.map(async (tf) => {
          const inner = await listFiles(tf.id);
          return inner
            .filter((f) => f.mimeType !== FOLDER_MIME)
            .map((f) => ({ ...f, groupLabel: sf.name, typeLabel: tf.name }));
        })
      );
      return [...here, ...deeper.flat()];
    })
  );

  return [...looseFiles, ...nested.flat()];
}

// Opens a Google Drive resumable-upload session and hands back the session
// URL. The browser then PUTs file bytes DIRECTLY to that URL - the request
// never passes through our server, so there is no body-size ceiling on our
// side (Vercel's serverless body limit never applies) and Drive's own real
// upload progress is exposed to the client as it happens.
// `origin` is NOT optional in practice. Google only attaches
// Access-Control-Allow-Origin to the *upload response* if the browser's origin
// was declared when the session was created. Without it the browser uploads
// every byte successfully, then blocks reading the reply - the XHR fires
// onerror, the app reports "Network error during upload", and the file is
// silently left orphaned in Drive with no database record. Always pass
// req.headers.get("origin") through from the calling route.
export async function createResumableSession(folderId, filename, mimeType, sizeBytes, origin) {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mimeType || "application/octet-stream",
        "X-Upload-Content-Length": String(sizeBytes || 0),
        ...(origin ? { Origin: origin } : {}),
      },
      body: JSON.stringify({ name: filename, parents: [folderId] }),
    }
  );
  if (!res.ok) {
    throw new Error(`Drive session init failed: ${res.status} ${await res.text()}`);
  }
  const sessionUrl = res.headers.get("Location");
  if (!sessionUrl) throw new Error("Drive did not return a resumable session URL");
  return sessionUrl;
}

// After the browser finishes the direct PUT, fetch the final file metadata
// (id/name/mimeType/webViewLink) the same way uploadFile() used to return it,
// so every caller's downstream code (DB inserts, etc.) stays unchanged.
export async function getFileMeta(fileId) {
  const drive = getDriveClient();
  const res = await drive.files.get({
    fileId,
    fields: "id,name,mimeType,webViewLink,createdTime",
    supportsAllDrives: true,
  });
  return res.data;
}

// Look up a folder by exact name under a parent WITHOUT creating it. Used when
// adopting the folder a clinic already maintains by hand for a patient, where
// creating a second one beside it is the failure we are trying to avoid.
export async function findFolderByName(name, parentId) {
  const drive = getDriveClient();
  const safeName = String(name || "").replace(/'/g, "\\'");
  if (!safeName) return null;
  const q = `name='${safeName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await drive.files.list({
    q,
    fields: "files(id,name)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  // Ambiguous match is treated as no match - picking one at random risks
  // filing a patient's scans into a different patient's folder.
  if (res.data.files && res.data.files.length === 1) return res.data.files[0].id;
  return null;
}

// Raw OAuth token for the few calls made with fetch rather than the Drive
// client - trashing a file, for instance, where the client wrapper adds
// nothing over a plain PATCH.
export async function getAccessToken() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  return token;
}
