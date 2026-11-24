import { ConfigError } from "../../Errors";
import { configKey } from "../Decorators";

interface BridgeConfigEncryptionYAML {
  storagePath: string;
  autoResetOnKeyConflict?: boolean;
}

export class BridgeConfigEncryption {
  @configKey(
    "Path to the directory used to store encryption files. These files must be persist between restarts of the service.",
  )
  public readonly storagePath: string;

  @configKey(
    "Automatically reset the crypto store if it is found to be out of sync with the homeserver (e.g. after it was restored from a backup), instead of failing to start. Messages encrypted for the old device can no longer be decrypted afterwards. Defaults to false.",
    true,
  )
  public readonly autoResetOnKeyConflict: boolean;

  constructor(
    config: BridgeConfigEncryptionYAML,
    cache: unknown | undefined,
    queue: unknown | undefined,
  ) {
    if (typeof config.storagePath !== "string" || !config.storagePath) {
      throw new ConfigError(
        "encryption.storagePath",
        "The crypto storage path must not be empty.",
      );
    }
    this.storagePath = config.storagePath;

    if (
      config.autoResetOnKeyConflict !== undefined &&
      typeof config.autoResetOnKeyConflict !== "boolean"
    ) {
      throw new ConfigError(
        "encryption.autoResetOnKeyConflict",
        "Must be a boolean.",
      );
    }
    this.autoResetOnKeyConflict = config.autoResetOnKeyConflict ?? false;

    if (!cache) {
      throw new ConfigError(
        "cache",
        "Encryption requires the Redis cache to be enabled.",
      );
    }
    if (queue) {
      throw new ConfigError(
        "queue",
        "Encryption does not support message queues.",
      );
    }
  }
}
