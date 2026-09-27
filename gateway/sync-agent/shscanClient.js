const fetch = require("node-fetch");

const BASE = process.env.SHSCAN_API_URL || "https://shscan.com";
const KEY = process.env.GATEWAY_API_KEY;

async function shscanFetch(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KEY}`,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    throw new Error(`shscan.com ${options.method || "GET"} ${path} -> ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

const getWorklistQueue = () => shscanFetch("/api/gateway/worklist-queue");

const confirmWorklistCreated = (visitId, dicomStudyUid) =>
  shscanFetch("/api/gateway/worklist-created", { method: "POST", body: JSON.stringify({ visitId, dicomStudyUid }) });

const getWorklistDeletionQueue = () => shscanFetch("/api/gateway/worklist-deletions");

const confirmWorklistDeleted = (dicomStudyUid) =>
  shscanFetch("/api/gateway/worklist-deletions", { method: "POST", body: JSON.stringify({ dicomStudyUid }) });

const startStudyUpload = (payload) =>
  shscanFetch("/api/gateway/study-upload-session", { method: "POST", body: JSON.stringify(payload) });

const completeStudyUpload = (payload) =>
  shscanFetch("/api/gateway/study-upload-complete", { method: "POST", body: JSON.stringify(payload) });

module.exports = {
  getWorklistQueue, confirmWorklistCreated,
  getWorklistDeletionQueue, confirmWorklistDeleted,
  startStudyUpload, completeStudyUpload,
};
