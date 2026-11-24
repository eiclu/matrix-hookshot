import { writeFileSync } from "fs";
import { readFile, readdir, rm, writeFile } from "fs/promises";
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
    `To do this automatically in the future, set ` +
    `encryption.autoResetOnKeyConflict to true. ` +
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

/**
 * Marker file written into the crypto store when a key conflict was detected,
 * so that the next start of the bridge can reset the crypto store.
 */
export const RESET_REQUIRED_FILE = "hookshot-reset-required.json";
/**
 * Records when the crypto store was last reset automatically.
 */
export const LAST_AUTO_RESET_FILE = "hookshot-last-auto-reset.json";
/**
 * Minimum time between two automatic resets. If the crypto store goes out of
 * sync again within this time, something keeps breaking it (e.g. a second
 * instance using the same bot users), and resetting again would not help.
 */
export const AUTO_RESET_MIN_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Flags the crypto store to be reset on the next start.
 *
 * This is synchronous because it is called while the process is exiting.
 */
export function markCryptoStoreResetRequired(
  storagePath: string,
  reason: string,
  now = Date.now(),
): void {
  writeFileSync(
    join(storagePath, RESET_REQUIRED_FILE),
    JSON.stringify({ reason, detectedAt: now }),
  );
}

export async function clearCryptoStoreResetRequired(
  storagePath: string,
): Promise<void> {
  await rm(join(storagePath, RESET_REQUIRED_FILE), { force: true });
}

export async function recordCryptoStoreAutoReset(
  storagePath: string,
  now = Date.now(),
): Promise<void> {
  await writeFile(
    join(storagePath, LAST_AUTO_RESET_FILE),
    JSON.stringify({ resetAt: now }),
  );
}

async function readJsonFile(path: string): Promise<unknown> {
  let contents: string;
  try {
    contents = await readFile(path, "utf-8");
  } catch (ex) {
    if ((ex as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw ex;
  }
  try {
    return JSON.parse(contents);
  } catch {
    // The file exists but is unreadable, e.g. because the process was killed
    // while writing it.
    return {};
  }
}

export type PendingCryptoStoreAutoReset =
  | { action: "none" }
  | { action: "reset"; reason: string }
  | { action: "skip"; reason: string; lastResetAt: number };

/**
 * Determines whether the crypto store was flagged for a reset, and whether an
 * automatic reset may be done now.
 */
export async function getPendingCryptoStoreAutoReset(
  storagePath: string,
  now = Date.now(),
): Promise<PendingCryptoStoreAutoReset> {
  const marker = await readJsonFile(join(storagePath, RESET_REQUIRED_FILE));
  if (marker === undefined) {
    return { action: "none" };
  }
  const { reason } = (marker ?? {}) as { reason?: unknown };
  const reasonText =
    typeof reason === "string" && reason ? reason : "unknown reason";

  const lastReset = await readJsonFile(join(storagePath, LAST_AUTO_RESET_FILE));
  const { resetAt } = (lastReset ?? {}) as { resetAt?: unknown };
  if (
    typeof resetAt === "number" &&
    now - resetAt >= 0 &&
    now - resetAt < AUTO_RESET_MIN_INTERVAL_MS
  ) {
    return { action: "skip", reason: reasonText, lastResetAt: resetAt };
  }
  return { action: "reset", reason: reasonText };
}
