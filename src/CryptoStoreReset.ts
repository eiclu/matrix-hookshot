import { Logger } from "matrix-appservice-bridge";
import { IAppserviceRegistration, MatrixClient } from "matrix-bot-sdk";
import { getAppservice } from "./Appservice";
import { BridgeConfig } from "./config/Config";
import BotUsersManager from "./managers/BotUsersManager";
import {
  clearCryptoStoreResetRequired,
  emptyDirectory,
  getPendingCryptoStoreAutoReset,
  recordCryptoStoreAutoReset,
} from "./CryptoStoreUtils";

const log = new Logger("CryptoStoreReset");

/**
 * Resets the bridge's encryption state: logs out the crypto device of every
 * bot user, forgets their access tokens and removes the crypto store from disk.
 *
 * This creates its own appservice and storage instances, so it must run
 * before the bridge sets up its own (the crypto storage provider caches the
 * device ID in memory).
 */
export async function resetCryptoStore(
  config: BridgeConfig,
  registration: IAppserviceRegistration,
): Promise<void> {
  const { appservice, storage, cryptoStorage } = getAppservice(
    config,
    registration,
  );
  try {
    if (!cryptoStorage) {
      log.info(
        `Encryption is not enabled in the configuration file, so there is no encryption state to be reset`,
      );
      return;
    }

    const botUsersManager = new BotUsersManager(config, appservice);

    for (const botUser of botUsersManager.botUsers) {
      try {
        const userStorage = storage.storageForUser?.(botUser.userId);
        if (!userStorage) {
          log.warn(`No storage for ${botUser.userId}`);
          continue;
        }
        const userCryptoStorage = cryptoStorage?.storageForUser(botUser.userId);
        if (!userCryptoStorage) {
          log.warn(`No crypto storage for ${botUser.userId}`);
          continue;
        }
        const deviceId = await userCryptoStorage?.getDeviceId();
        if (!deviceId) {
          log.debug(
            `No crypto device ID for ${botUser.userId}: no crypto state to remove`,
          );
          continue;
        }

        const accessToken = await userStorage?.readValue("accessToken");
        if (!accessToken) {
          // The device was created by the appservice itself (MSC4190), so
          // there is no session to log out. Delete the device instead.
          try {
            const asClient = new MatrixClient(
              config.bridge.url,
              registration.as_token,
            );
            asClient.impersonateUserId(botUser.userId);
            await asClient.doRequest(
              "DELETE",
              `/_matrix/client/v3/devices/${encodeURIComponent(deviceId)}`,
              undefined,
              {},
            );
            log.info(`Deleted crypto device for ${botUser.userId}`);
          } catch (ex: unknown) {
            log.warn(
              `Could not delete crypto device ${deviceId} of ${botUser.userId}; it may need to be removed manually`,
              ex,
            );
          }
          continue;
        }

        const client = new MatrixClient(
          config.bridge.url,
          accessToken,
          userStorage,
          userCryptoStorage,
        );
        await client.doRequest("POST", "/_matrix/client/v3/logout", {
          user_id: botUser.userId,
          // Send both the stable and unstable device_id params, mirroring
          // MatrixClient's own impersonation handling, for compatibility with
          // homeservers old and new (see matrix-org/matrix-hookshot#1398).
          device_id: deviceId,
          "org.matrix.msc3202.device_id": deviceId,
        });
        log.info(`Logged out crypto device for ${botUser.userId}`);

        try {
          await userStorage.storeValue("accessToken", "");
          log.info(`Deleted access token for ${botUser.userId}`);
        } catch (ex: unknown) {
          log.error(`Failed to delete access token for ${botUser.userId}`, ex);
        }
      } catch (ex: unknown) {
        log.error(`Failed to log out crypto device for ${botUser.userId}`, ex);
      }
    }

    if (config.encryption?.storagePath) {
      try {
        // Only empty the directory, as it may be a mount point (e.g. a Docker
        // volume) which cannot be removed.
        if (await emptyDirectory(config.encryption.storagePath)) {
          log.info("Removed crypto store from disk");
        } else {
          log.info("No crypto store found on disk");
        }
      } catch (ex) {
        log.error("Failed to remove crypto store from disk", ex);
      }
    }
  } finally {
    await storage.disconnect?.();
  }
}

/**
 * If a previous run of the bridge detected that its crypto store is out of
 * sync with the homeserver, reset the crypto store before starting up.
 *
 * Only call this when `encryption.autoResetOnKeyConflict` is enabled.
 */
export async function runPendingCryptoStoreAutoReset(
  config: BridgeConfig,
  registration: IAppserviceRegistration,
): Promise<void> {
  const storagePath = config.encryption?.storagePath;
  if (!storagePath) {
    return;
  }
  const pending = await getPendingCryptoStoreAutoReset(storagePath);
  if (pending.action === "none") {
    return;
  }
  if (pending.action === "skip") {
    log.error(
      `The crypto store is out of sync with the homeserver again, but it was already reset automatically at ` +
        `${new Date(pending.lastResetAt).toISOString()}. Not resetting it again, to avoid a reset loop. ` +
        `This usually means that another Hookshot instance is using the same bot users, or that the ` +
        `crypto store is being modified or restored externally. Fix the cause, then reset the crypto ` +
        `store manually with "pnpm start:resetcrypto".`,
    );
    await clearCryptoStoreResetRequired(storagePath);
    return;
  }

  log.warn(
    `A previous run found that the crypto store is out of sync with the homeserver ` +
      `(${pending.reason}). Resetting the crypto store automatically, as ` +
      `encryption.autoResetOnKeyConflict is enabled. Messages encrypted for the old ` +
      `device can no longer be decrypted.`,
  );
  await resetCryptoStore(config, registration);
  // The reset emptied the store directory, which also removed the marker.
  await recordCryptoStoreAutoReset(storagePath);
  log.info("Crypto store was reset, continuing startup with a new device");
}
