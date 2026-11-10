import multer from 'multer';
import { HttpError } from './errors.js';

const maxImageBytes = 10 * 1024 * 1024;
const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxImageBytes, files: 1, fields: 4, parts: 5 },
  fileFilter: (_req, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(new HttpError(415, 'Only JPEG, PNG, and WebP images are accepted.', 'UNSUPPORTED_IMAGE_TYPE'));
      return;
    }
    callback(null, true);
  },
});

export function validateImageSignature(mimeType: string, buffer: Buffer) {
  const isJpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng = buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = buffer.length >= 12
    && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP';
  const signatureMimeType = isJpeg ? 'image/jpeg' : isPng ? 'image/png' : isWebp ? 'image/webp' : null;

  if (!signatureMimeType || signatureMimeType !== mimeType) {
    throw new HttpError(415, 'The uploaded file content does not match an allowed image type.', 'IMAGE_SIGNATURE_MISMATCH');
  }
}
