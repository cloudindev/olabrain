/**
 * Credential vault (CLAUDE.md §2.5, §4): AES-256-GCM envelope encryption.
 *
 *   master key (env/KMS, versioned) ──wraps──► tenant data key (tenant_keys)
 *   tenant data key ──encrypts──► secret JSON (credentials.encrypted_blob)
 *
 * The tenant id is bound as AAD, so a blob copied to another tenant fails to decrypt.
 * Plaintext secrets only exist in memory, inside apps/connector, at call time.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { credentials, tenantKeys, type Tx } from "@brainagent/db";
import { and, eq } from "drizzle-orm";

const IV_BYTES = 12;
const TAG_BYTES = 16;

export type Keyring = {
  current: { version: number; key: Buffer };
  previous?: { version: number; key: Buffer };
};

export function parseMasterKey(base64: string): Buffer {
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) throw new Error("vault master key must be 32 bytes (base64)");
  return key;
}

function seal(key: Buffer, plaintext: Buffer, aad: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

function open(key: Buffer, sealed: string, aad: string): Buffer {
  const raw = Buffer.from(sealed, "base64");
  if (raw.length < IV_BYTES + TAG_BYTES) throw new Error("vault: corrupt blob");
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, IV_BYTES));
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
}

export class Vault {
  constructor(private readonly keyring: Keyring) {}

  private masterKey(version: number): Buffer {
    if (version === this.keyring.current.version) return this.keyring.current.key;
    if (this.keyring.previous && version === this.keyring.previous.version)
      return this.keyring.previous.key;
    throw new Error(`vault: master key version ${version} is not available`);
  }

  /** Returns the tenant data key, creating and wrapping it on first use. */
  private async tenantKey(tx: Tx, tenantId: string): Promise<Buffer> {
    const [row] = await tx
      .select()
      .from(tenantKeys)
      .where(eq(tenantKeys.tenantId, tenantId))
      .limit(1);
    if (row) {
      return open(this.masterKey(row.keyVersion), row.wrappedKey, `tenant-key:${tenantId}`);
    }
    const dataKey = randomBytes(32);
    await tx
      .insert(tenantKeys)
      .values({
        tenantId,
        wrappedKey: seal(this.keyring.current.key, dataKey, `tenant-key:${tenantId}`),
        keyVersion: this.keyring.current.version,
      })
      .onConflictDoNothing();
    // Re-read in case a concurrent request created it first.
    const [stored] = await tx
      .select()
      .from(tenantKeys)
      .where(eq(tenantKeys.tenantId, tenantId))
      .limit(1);
    return open(this.masterKey(stored!.keyVersion), stored!.wrappedKey, `tenant-key:${tenantId}`);
  }

  async put(tx: Tx, tenantId: string, secret: Record<string, unknown>): Promise<string> {
    const key = await this.tenantKey(tx, tenantId);
    const [row] = await tx
      .insert(credentials)
      .values({
        tenantId,
        encryptedBlob: seal(key, Buffer.from(JSON.stringify(secret)), `credential:${tenantId}`),
        keyVersion: this.keyring.current.version,
      })
      .returning({ id: credentials.id });
    return row!.id;
  }

  async update(
    tx: Tx,
    tenantId: string,
    credentialId: string,
    secret: Record<string, unknown>,
  ): Promise<void> {
    const key = await this.tenantKey(tx, tenantId);
    await tx
      .update(credentials)
      .set({
        encryptedBlob: seal(key, Buffer.from(JSON.stringify(secret)), `credential:${tenantId}`),
        keyVersion: this.keyring.current.version,
      })
      .where(and(eq(credentials.id, credentialId), eq(credentials.tenantId, tenantId)));
  }

  async get<T extends Record<string, unknown>>(
    tx: Tx,
    tenantId: string,
    credentialId: string,
  ): Promise<T> {
    const [row] = await tx
      .select()
      .from(credentials)
      .where(and(eq(credentials.id, credentialId), eq(credentials.tenantId, tenantId)))
      .limit(1);
    if (!row) throw new Error("vault: credential not found");
    const key = await this.tenantKey(tx, tenantId);
    return JSON.parse(open(key, row.encryptedBlob, `credential:${tenantId}`).toString("utf8")) as T;
  }

  async delete(tx: Tx, tenantId: string, credentialId: string): Promise<void> {
    await tx
      .delete(credentials)
      .where(and(eq(credentials.id, credentialId), eq(credentials.tenantId, tenantId)));
  }
}
