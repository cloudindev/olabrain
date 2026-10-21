import { describe, expect, it } from "vitest";
import { MAX_ATTACHMENT_BYTES, attachmentsSchema, base64Bytes } from "./attachments";

const b64 = (bytes: number) => Buffer.alloc(bytes, 7).toString("base64");

describe("attachments", () => {
  it("measures base64 payloads without decoding", () => {
    for (const n of [0, 1, 2, 3, 1000, 1001]) expect(base64Bytes(b64(n))).toBe(n);
  });

  it("accepts supported files within the size budget", () => {
    const ok = attachmentsSchema.safeParse([
      { name: "foto.png", mediaType: "image/png", data: b64(1000) },
      { name: "informe.pdf", mediaType: "application/pdf", data: b64(1000) },
    ]);
    expect(ok.success).toBe(true);
  });

  it("rejects unknown types, too many files and oversized payloads", () => {
    const one = { name: "a.png", mediaType: "image/png", data: b64(10) };
    expect(
      attachmentsSchema.safeParse([{ ...one, mediaType: "application/x-msdownload" }]).success,
    ).toBe(false);
    expect(attachmentsSchema.safeParse([one, one, one, one]).success).toBe(false);
    expect(
      attachmentsSchema.safeParse([{ ...one, data: b64(MAX_ATTACHMENT_BYTES + 1) }]).success,
    ).toBe(false);
    expect(attachmentsSchema.safeParse([{ ...one, data: "no es base64!" }]).success).toBe(false);
  });
});
