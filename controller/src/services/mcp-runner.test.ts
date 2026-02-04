// CRITICAL
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createInterface } from "node:readline";
import { Readable, PassThrough } from "node:stream";
import { getNpxPath, readLineWithTimeout } from "./mcp-runner";

describe("getNpxPath", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("path resolution", () => {
    it("returns npx by default when no runtime override", () => {
      delete process.env["VLLM_STUDIO_RUNTIME_BIN"];
      delete process.env["SNAP"];
      const path = getNpxPath();
      // Should return npx or a system path
      expect(path).toMatch(/npx$/);
    });

    it("respects VLLM_STUDIO_RUNTIME_BIN override", () => {
      process.env["VLLM_STUDIO_RUNTIME_BIN"] = "/nonexistent/path";
      const path = getNpxPath();
      // Since the path doesn't exist, should fall back to default
      expect(path).toMatch(/npx$/);
    });
  });
});

describe("readLineWithTimeout", () => {
  describe("successful reads", () => {
    it("reads a line from the stream", async () => {
      const stream = new PassThrough();
      const reader = createInterface({ input: stream });

      const readPromise = readLineWithTimeout(reader, 5000);
      stream.write("test line\n");

      const result = await readPromise;
      expect(result).toBe("test line");

      reader.close();
      stream.end();
    });

    it("handles multiple lines (returns first)", async () => {
      const stream = new PassThrough();
      const reader = createInterface({ input: stream });

      const readPromise = readLineWithTimeout(reader, 5000);
      stream.write("first line\nsecond line\n");

      const result = await readPromise;
      expect(result).toBe("first line");

      reader.close();
      stream.end();
    });

    it("handles empty line", async () => {
      const stream = new PassThrough();
      const reader = createInterface({ input: stream });

      const readPromise = readLineWithTimeout(reader, 5000);
      stream.write("\n");

      const result = await readPromise;
      expect(result).toBe("");

      reader.close();
      stream.end();
    });

    it("handles line with special characters", async () => {
      const stream = new PassThrough();
      const reader = createInterface({ input: stream });

      const readPromise = readLineWithTimeout(reader, 5000);
      stream.write('{"jsonrpc":"2.0","id":1,"result":{}}\n');

      const result = await readPromise;
      expect(result).toBe('{"jsonrpc":"2.0","id":1,"result":{}}');

      reader.close();
      stream.end();
    });
  });

  describe("timeout handling", () => {
    it("rejects on timeout", async () => {
      const stream = new PassThrough();
      const reader = createInterface({ input: stream });

      // Very short timeout, no data written
      await expect(readLineWithTimeout(reader, 10)).rejects.toThrow("MCP command timed out");

      reader.close();
      stream.end();
    });
  });

  describe("close handling", () => {
    it("rejects when stream closes without data", async () => {
      const stream = new PassThrough();
      const reader = createInterface({ input: stream });

      const readPromise = readLineWithTimeout(reader, 5000);
      stream.end(); // Close without writing

      await expect(readPromise).rejects.toThrow("MCP command closed without response");

      reader.close();
    });
  });

  describe("error handling", () => {
    it("rejects on error from error source", async () => {
      const stream = new PassThrough();
      const reader = createInterface({ input: stream });
      const errorSource = new PassThrough();

      const readPromise = readLineWithTimeout(reader, 5000, errorSource);
      errorSource.emit("error", new Error("Test error"));

      await expect(readPromise).rejects.toThrow("Test error");

      reader.close();
      stream.end();
    });
  });
});
