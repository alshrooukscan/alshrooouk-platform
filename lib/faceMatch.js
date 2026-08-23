"use client";
// Self-hosted face detection + descriptor extraction. Everything runs in the
// browser via the model weights in /public/models - nothing is ever sent to
// a third-party face-recognition service. The server only ever receives the
// resulting 128-number descriptor, never a raw photo, for the live capture step.

let faceapi = null;
let modelsLoaded = false;

async function getFaceApi() {
  if (!faceapi) {
    faceapi = await import("face-api.js");
  }
  return faceapi;
}

export async function loadFaceModels() {
  if (modelsLoaded) return;
  const api = await getFaceApi();
  const MODEL_URL = "/models";
  await Promise.all([
    api.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    api.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    api.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
  ]);
  modelsLoaded = true;
}

// Returns a plain array of 128 numbers, or null if no face was found in the image.
export async function extractDescriptor(imageOrCanvasOrVideo) {
  const api = await getFaceApi();
  await loadFaceModels();
  const result = await api
    .detectSingleFace(imageOrCanvasOrVideo, new api.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (!result) return null;
  return Array.from(result.descriptor);
}
