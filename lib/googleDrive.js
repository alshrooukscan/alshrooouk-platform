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
