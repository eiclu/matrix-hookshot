import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { MatrixError } from "matrix-bot-sdk";
import {
  emptyDirectory,
  isCryptoStoreMismatchError,
} from "../src/CryptoStoreUtils";

describe("isCryptoStoreMismatchError", () => {
  const otkError =
    "One time key signed_curve25519:AAAAAAAAAFA already exists. Old key: {\"key\":\"a\"}; new key: {'key': 'b'}";

  it("matches a homeserver one-time key conflict", () => {
    const error = new MatrixError(
      { errcode: "M_UNKNOWN", error: otkError },
      400,
      {},
    );
    expect(isCryptoStoreMismatchError(error)).toBe(true);
  });

  it("matches an error by its message", () => {
    expect(isCryptoStoreMismatchError(new Error(otkError))).toBe(true);
  });

  it("does not match unrelated errors", () => {
    const error = new MatrixError(
      { errcode: "M_NOT_FOUND", error: "Event not found." },
      404,
      {},
    );
    expect(isCryptoStoreMismatchError(error)).toBe(false);
    expect(isCryptoStoreMismatchError(new Error("boom"))).toBe(false);
    expect(isCryptoStoreMismatchError(undefined)).toBe(false);
    expect(isCryptoStoreMismatchError("One time key x already exists")).toBe(
      false,
    );
  });
});

describe("emptyDirectory", () => {
  it("removes all contents but keeps the directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hookshot-cryptostore-"));
    try {
      await mkdir(join(dir, "_default", "nested"), { recursive: true });
      await writeFile(join(dir, "_default", "nested", "store.db"), "x");
      await writeFile(join(dir, ".hidden"), "x");

      expect(await emptyDirectory(dir)).toBe(true);
      expect(await readdir(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns false if the directory does not exist", async () => {
    const dir = join(tmpdir(), "hookshot-does-not-exist-" + Date.now());
    expect(await emptyDirectory(dir)).toBe(false);
  });
});
