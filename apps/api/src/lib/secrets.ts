/**
 * AES-256-GCM for secrets stored in the database (e.g. workspace AI keys).
 * The key comes from ENCRYPTION_KEY; changing it makes stored secrets
 * unreadable, so set it once per deployment.
 */
const SECRET = process.env.ENCRYPTION_KEY ?? process.env.JWT_SECRET ?? "dev-secret-change-me";
const VERSION = "v1";

let keyPromise: Promise<CryptoKey> | null = null;

function encryptionKey(): Promise<CryptoKey> {
  keyPromise ??= crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(SECRET))
    .then((raw) => crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]));
  return keyPromise;
}

export async function encryptSecret(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), new TextEncoder().encode(plain));
  return [VERSION, Buffer.from(iv).toString("base64"), Buffer.from(data).toString("base64")].join(":");
}

export async function decryptSecret(stored: string): Promise<string> {
  const [version, iv, data] = stored.split(":");
  if (version !== VERSION || !iv || !data) throw new Error("Unsupported secret format");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: Buffer.from(iv, "base64") },
    await encryptionKey(),
    Buffer.from(data, "base64"),
  );
  return new TextDecoder().decode(plain);
}
