"use client";

// Client-side direct-to-Drive upload. Two-step protocol:
//   1. POST to `initEndpoint` with file metadata -> get { sessionUrl }
//   2. PUT the file bytes straight to that Google session URL (never touches
//      our server), tracking real byte-for-byte progress via XHR.upload
// Google's resumable endpoint accepts chunked PUTs and will resume from the
// last confirmed byte on retry, so a dropped connection doesn't mean
// starting over on a multi-GB file. A single PUT of the whole body also
// works fine for typical files and is what we use here for simplicity;
// Drive treats it identically to a "complete in one chunk" resumable upload.
//
// onProgress(fraction 0..1) is called continuously during the PUT.
// Resolves to the Drive file id.
// Guards against the user navigating away mid-upload. Without this the browser
// tears the request down silently: the page changes, no warning is shown, and
// staff retry - which is how one scan ended up uploaded three times in a day.
function beforeUnload(e) {
  e.preventDefault();
  e.returnValue = "An upload is still in progress. Leaving this page will cancel it.";
  return e.returnValue;
}

export async function uploadFileToDrive({ file, initEndpoint, initBody, onProgress, authToken }) {
  const initRes = await fetch(initEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Staff-facing upload routes require a real signed-in staff session before
      // they'll hand out a Drive write session. Portal routes authenticate off
      // the portal_session cookie instead and ignore this.
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({ ...initBody, sizeBytes: file.size }),
  });
  const initJson = await initRes.json();
  if (!initRes.ok) throw new Error(initJson.error || "Could not start upload");
  const { sessionUrl } = initJson;

  // Armed for the whole transfer and always removed in the finally below, so a
  // failed or cancelled upload can never leave the warning stuck on the page.
  window.addEventListener("beforeunload", beforeUnload);

  let fileId;
  try {
  fileId = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", sessionUrl, true);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const body = JSON.parse(xhr.responseText);
          resolve(body.id);
        } catch {
          reject(new Error("Upload finished but Drive response could not be parsed"));
        }
      } else {
        reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText?.slice(0, 200)}`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.send(file);
  });
  } finally {
    window.removeEventListener("beforeunload", beforeUnload);
  }

  if (onProgress) onProgress(1);
  return fileId;
}
