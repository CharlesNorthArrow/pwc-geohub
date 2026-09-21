/**
 * Upload ceiling for raw-file admin uploads, shared by the routes and the
 * dialogs (which refuse an oversized selection before sending it). Vercel
 * caps request bodies at 100 MB; the largest DOE file today (end-of-year
 * attendance) is ~88 MB.
 */
export const MAX_UPLOAD_BYTES = 95 * 1024 * 1024;

export const TOO_LARGE_MESSAGE =
  'This upload is larger than the hub’s 95 MB limit (set by the hosting platform). ' +
  'If DOE’s file has grown past it, contact North Arrow.';
