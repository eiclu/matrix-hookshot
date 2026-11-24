import { BridgeConfig, parseRegistrationFile } from "../config/Config";
import { Logger } from "matrix-appservice-bridge";
import { LogService } from "matrix-bot-sdk";
import { resetCryptoStore } from "../CryptoStoreReset";

const log = new Logger("ResetCryptoStore");

async function start() {
  const { configFiles, registrationFile } =
    BridgeConfig.getConfigOptionsFromArgv();
  const config = await BridgeConfig.parseConfig(configFiles, process.env);
  const registration = await parseRegistrationFile(registrationFile);
  Logger.configure({
    console: config.logging.level,
    colorize: config.logging.colorize,
    json: config.logging.json,
    timestampFormat: config.logging.timestampFormat,
  });
  LogService.setLogger(Logger.botSdkLogger);

  await resetCryptoStore(config, registration);
}

start().catch((ex) => {
  log.error("ResetCryptoStore encountered an error and has stopped:", ex);
  process.exitCode = 1;
});
