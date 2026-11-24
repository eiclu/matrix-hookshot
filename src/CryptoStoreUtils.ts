import { readdir, rm } from "fs/promises";
import { join } from "path";

/**
 * Matches the error a homeserver returns when the local crypto store no longer
 * matches the device keys the homeserver holds for the same device, e.g.
 * "One time key signed_curve25519:AAAAAAAAAFA already exists. Old key: ...".
 */
const OTK_ALREADY_EXISTS = /One time key \S+ already exists/;

/**
 * Whether an error indicates that the crypto store is out of sync with the
 * homeserver (lost, rolled back, or shared between two running instances).
 * Hookshot cannot recover from this by itself; the crypto store must be reset.
 */
export function isCryptoStoreMismatchError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }
  const { message, body } = err as {
    message?: unknown;
    body?: { error?: unknown };
  };
  return [message, body?.error].some(
    (text) => typeof text === "string" && OTK_ALREADY_EXISTS.test(text),
  );
}

export function cryptoStoreMismatchHelp(storagePath: string): string {
  return (
    `The crypto store at "${storagePath}" does not match the encryption keys ` +
    `the homeserver holds for this device. This happens when the crypto store ` +
    `was deleted, modified or restored from an older backup, or when two ` +
    `Hookshot instances share the same bot device. Hookshot cannot start ` +
    `until the crypto store is reset: stop Hookshot and run ` +
    `"pnpm start:resetcrypto" (or, in Docker, "node ` +
    `/bin/matrix-hookshot/App/ResetCryptoStore.js /data/config.yml ` +
    `/data/registration.yml" with the container's entrypoint overridden). ` +
    `See https://matrix-org.github.io/matrix-hookshot/latest/advanced/encryption.html`
  );
}

/**
 * Removes everything inside a directory, but keeps the directory itself.
 *
 * The crypto store directory is commonly a bind mount or volume (e.g. in
 * Docker), which cannot be removed from inside the container (EBUSY), so
 * deleting the directory itself is not an option.
 *
 * @returns false if the directory did not exist.
 */
export async function emptyDirectory(path: string): Promise<boolean> {
  let entries: string[];
  try {
    entries = await readdir(path);
  } catch (ex) {
    if ((ex as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw ex;
  }
  await Promise.all(
    entries.map((entry) =>
      rm(join(path, entry), { recursive: true, force: true }),
    ),
  );
  return true;
}
