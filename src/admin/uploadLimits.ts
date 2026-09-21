/**
 * Upload ceiling for raw-file admin uploads, shared by the routes and the
 * dialogs (which refuse an oversized selection before sending it). Large
 * files travel via Vercel Blob (functions only accept 4.5 MB bodies), so
 * this cap is about parsing memory: the largest DOE file today (end-of-year
 * attendance, ~88 MB) peaks around 1 GB.
 */
export const MAX_UPLOAD_BYTES = 95 * 1024 * 1024;

export const TOO_LARGE_MESSAGE =
  'This upload is larger than the hub’s 95 MB limit. ' +
  'If DOE’s file has grown past it, contact North Arrow.';
