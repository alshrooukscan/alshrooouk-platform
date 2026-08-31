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

// Opens a Google Drive resumable-upload session and hands back the session
// URL. The browser then PUTs file bytes DIRECTLY to that URL - the request
// never passes through our server, so there is no body-size ceiling on our
// side (Vercel's serverless body limit never applies) and Drive's own real
// upload progress is exposed to the client as it happens.
export async function createResumableSession(folderId, filename, mimeType, sizeBytes) {
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
