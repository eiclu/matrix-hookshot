import { describe, expect, it } from "vitest";
import { BridgeConfigEncryption } from "../../../src/config/sections/Encryption";

describe("config/sections/Encryption", () => {
  it("disables automatic crypto store resets by default", () => {
    const config = new BridgeConfigEncryption(
      { storagePath: "./cryptostore" },
      {},
      undefined,
    );
    expect(config.autoResetOnKeyConflict).toBe(false);
  });

  it("enables automatic crypto store resets", () => {
    const config = new BridgeConfigEncryption(
      { storagePath: "./cryptostore", autoResetOnKeyConflict: true },
      {},
      undefined,
    );
    expect(config.autoResetOnKeyConflict).toBe(true);
  });

  it("rejects a non-boolean autoResetOnKeyConflict", () => {
    expect(
      () =>
        new BridgeConfigEncryption(
          {
            storagePath: "./cryptostore",
            autoResetOnKeyConflict: "yes" as unknown as boolean,
          },
          {},
          undefined,
        ),
    ).toThrow();
  });
});
