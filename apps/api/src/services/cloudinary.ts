import { createHash } from 'node:crypto';
import type { Express } from 'express';
import { z } from 'zod';
import { config } from '../lib/config.js';
import { HttpError } from '../lib/errors.js';

function createCloudinaryUploadSignature(folder: string, timestamp: number) {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = config;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw new HttpError(503, 'Cloudinary image uploads are not configured.', 'IMAGE_PROVIDER_UNAVAILABLE');
  }

  const params = `folder=${folder}&timestamp=${timestamp}${CLOUDINARY_API_SECRET}`;
  const signature = createHash('sha1').update(params).digest('hex');
  return {
    cloudName: CLOUDINARY_CLOUD_NAME,
    apiKey: CLOUDINARY_API_KEY,
    timestamp,
    folder,
    signature,
  };
}

const cloudinaryResponseSchema = z.object({
  public_id: z.string().min(1).max(255),
  secure_url: z.string().url(),
});

export async function uploadImageToCloudinary(file: Express.Multer.File, folder: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  const credentials = createCloudinaryUploadSignature(folder, timestamp);
  const body = new FormData();
  body.append('file', new Blob([Uint8Array.from(file.buffer)]), file.originalname);
  body.append('api_key', credentials.apiKey);
  body.append('timestamp', String(credentials.timestamp));
  body.append('folder', credentials.folder);
  body.append('signature', credentials.signature);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${credentials.cloudName}/image/upload`,
    { method: 'POST', body, signal: AbortSignal.timeout(30_000) },
  );
  if (!response.ok) {
    console.error(`Cloudinary upload failed with status ${response.status}.`);
    throw new HttpError(502, 'The image provider could not accept this upload.', 'IMAGE_UPLOAD_FAILED');
  }

  let providerPayload: unknown;
  try {
    providerPayload = await response.json();
  } catch {
    throw new HttpError(502, 'The image provider returned an invalid upload response.', 'INVALID_IMAGE_PROVIDER_RESPONSE');
  }
  const parsed = cloudinaryResponseSchema.safeParse(providerPayload);
  if (!parsed.success) {
    throw new HttpError(502, 'The image provider returned an invalid upload response.', 'INVALID_IMAGE_PROVIDER_RESPONSE');
  }

  return {
    publicId: parsed.data.public_id,
    imageUrl: cloudinaryDeliveryUrl(parsed.data.public_id, 1200),
    thumbnailUrl: cloudinaryDeliveryUrl(parsed.data.public_id, 320),
  };
}

export function cloudinaryDeliveryUrl(publicId: string, width: number) {
  if (!config.CLOUDINARY_CLOUD_NAME) {
    throw new HttpError(503, 'Cloudinary image delivery is not configured.', 'IMAGE_PROVIDER_UNAVAILABLE');
  }
  const transforms = `f_auto,q_auto,c_pad,w_${width},h_${width},b_white`;
  return `https://res.cloudinary.com/${config.CLOUDINARY_CLOUD_NAME}/image/upload/${transforms}/${publicId}`;
}

export function cloudinaryDeliveryUrls(publicId: string) {
  return {
    imageUrl: cloudinaryDeliveryUrl(publicId, 1200),
    thumbnailUrl: cloudinaryDeliveryUrl(publicId, 320),
  };
}
