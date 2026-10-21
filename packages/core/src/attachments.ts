import { z } from "zod";

/**
 * Files attached to a chat message. They go to the model with that message only (no
 * storage yet, ADR-013): images and PDFs as native model input, text files as text.
 */
export const ATTACHMENT_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;
export const ATTACHMENT_TEXT_TYPES = [
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
] as const;
export const ATTACHMENT_TYPES = [
  ...ATTACHMENT_IMAGE_TYPES,
  "application/pdf",
  ...ATTACHMENT_TEXT_TYPES,
] as const;
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];

/** Per message. Vercel caps request bodies at 4.5 MB and base64 adds a third. */
export const MAX_ATTACHMENTS = 3;
export const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;

/** Decoded size of a base64 string (without decoding it). */
export function base64Bytes(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

export const attachmentSchema = z.object({
  name: z.string().trim().min(1).max(200),
  mediaType: z.enum(ATTACHMENT_TYPES),
  /** Base64 without the data: prefix. */
  data: z
    .string()
    .min(1)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, "invalid base64"),
});
export type Attachment = z.infer<typeof attachmentSchema>;

export const attachmentsSchema = z
  .array(attachmentSchema)
  .max(MAX_ATTACHMENTS)
  .refine((list) => list.reduce((sum, a) => sum + base64Bytes(a.data), 0) <= MAX_ATTACHMENT_BYTES, {
    message: "attachments_too_large",
  });

export function isTextAttachment(type: string): boolean {
  return (ATTACHMENT_TEXT_TYPES as readonly string[]).includes(type);
}
export function isImageAttachment(type: string): boolean {
  return (ATTACHMENT_IMAGE_TYPES as readonly string[]).includes(type);
}
