import { Bridge } from "../Bridge";
import { BridgeConfig, parseRegistrationFile } from "../config/Config";
import { MatrixSender } from "../MatrixSender";
import { UserNotificationWatcher } from "../notifications/UserNotificationWatcher";
import { ListenerService } from "../ListenerService";
import { Logger, getBridgeVersion } from "matrix-appservice-bridge";
import { IAppserviceRegistration, LogService } from "matrix-bot-sdk";
import { getAppservice } from "../Appservice";
import BotUsersManager from "../managers/BotUsersManager";
import * as Sentry from "@sentry/node";
import { UserTokenStore } from "../tokens/UserTokenStore";
import { WebhookTransformer } from "../generic/WebhookTransformer";
import {
  cryptoStoreMismatchHelp,
  isCryptoStoreMismatchError,
  markCryptoStoreResetRequired,
} from "../CryptoStoreUtils";
import { runPendingCryptoStoreAutoReset } from "../CryptoStoreReset";

Logger.configure({ console: "info" });
const log = new Logger("App");

/**
 * Set up by start() when encryption is enabled. Handles errors that stop the
 * bridge because its crypto store is out of sync with the homeserver.
 */
let handleFatalCryptoStoreError: ((err: unknown) => void) | undefined;

export async function start(
  config: BridgeConfig,
  registration: IAppserviceRegistration,
) {
  const listener = new ListenerService(config.listeners);
  listener.start();
  Logger.configure({
    console: config.logging.level,
    colorize: config.logging.colorize,
    json: config.logging.json,
    timestampFormat: config.logging.timestampFormat,
  });
  LogService.setLogger(Logger.botSdkLogger);

  const autoResetCryptoStore = !!config.encryption?.autoResetOnKeyConflict;
  if (autoResetCryptoStore) {
    // Must happen before the appservice and its crypto storage are created.
    await runPendingCryptoStoreAutoReset(config, registration);
  }

  const { appservice, storage } = getAppservice(config, registration);

  const cryptoStoragePath = config.encryption?.storagePath;
  if (cryptoStoragePath) {
    let handled = false;
    handleFatalCryptoStoreError = (err) => {
      if (handled || !isCryptoStoreMismatchError(err)) {
        return;
      }
      handled = true;
      if (autoResetCryptoStore) {
        try {
          markCryptoStoreResetRequired(
            cryptoStoragePath,
            (err as Error).message ?? String(err),
          );
          log.error(
            "The crypto store is out of sync with the homeserver. It will be reset automatically when Hookshot is next started.",
          );
          return;
        } catch (ex) {
          log.error("Failed to flag the crypto store for a reset", ex);
        }
      }
      log.error(cryptoStoreMismatchHelp(cryptoStoragePath));
    };
    // Crypto setup failures are rethrown by the bot SDK as unhandled
    // rejections, which stop the process. We can't prevent that, but we can
    // explain how to recover from the most common cause, or flag the crypto
    // store to be reset automatically on the next start. Depending on timing,
    // the same error may instead reach the catch handler of startFromFile.
    process.on("uncaughtExceptionMonitor", (err) =>
      handleFatalCryptoStoreError?.(err),
    );
  }

  if (!config.queue) {
    const matrixSender = new MatrixSender(config, appservice);
    matrixSender.listen();
    const userNotificationWatcher = new UserNotificationWatcher(config);
    userNotificationWatcher.start();
  }

  if (config.sentry) {
    Sentry.init({
      dsn: config.sentry.dsn,
      environment: config.sentry.environment,
      release: getBridgeVersion(),
      serverName: config.bridge.domain,
      includeLocalVariables: true,
    });
    log.info("Sentry reporting enabled");
  }

  if (config.generic?.allowJsTransformationFunctions) {
    await WebhookTransformer.initialiseQuickJS();
  }

  const botUsersManager = new BotUsersManager(config, appservice);

  const tokenStore = await UserTokenStore.fromKeyPath(
    config.passFile,
    appservice.botIntent,
    config,
  );
  const bridgeApp = new Bridge(
    config,
    tokenStore,
    listener,
    appservice,
    storage,
    botUsersManager,
  );

  return {
    appservice,
    bridgeApp,
    storage,
    listener,
  };
}

async function startFromFile() {
  const { configFiles, registrationFile } =
    BridgeConfig.getConfigOptionsFromArgv();
  const config = await BridgeConfig.parseConfig(configFiles, process.env);
  const registration = await parseRegistrationFile(registrationFile);
  const { bridgeApp, listener, storage } = await start(config, registration);
  process.once("SIGTERM", () => {
    log.error("Got SIGTERM");
    listener.stop();
    bridgeApp.stop();
    // Don't care to await this, as the process is about to end
    storage.disconnect?.();
  });
  await bridgeApp.start();
  listener.finaliseListeners();
}

if (require.main === module) {
  startFromFile().catch((ex) => {
    handleFatalCryptoStoreError?.(ex);
    if (Logger.root.configured) {
      log.error("BridgeApp encountered an error and has stopped:", ex);
    } else {
      // eslint-disable-next-line no-console
      console.error("BridgeApp encountered an error and has stopped", ex);
    }
    process.exit(1);
  });
}
