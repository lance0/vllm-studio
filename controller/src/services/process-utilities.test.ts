// CRITICAL
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, unlinkSync, mkdirSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import {
  extractFlag,
  detectBackend,
  buildEnvironment,
  collectChildren,
  readLogTail,
} from "./process-utilities";
import type { Recipe } from "../types/models";

/**
 * Create a minimal recipe for testing.
 */
const createTestRecipe = (overrides: Partial<Recipe> = {}): Recipe => ({
  id: "test-recipe",
  name: "Test Recipe",
  model_path: "/models/test-model",
  backend: "vllm",
  port: 8000,
  tensor_parallel_size: 1,
  pipeline_parallel_size: 1,
  max_model_len: 4096,
  gpu_memory_utilization: 0.9,
  extra_args: {},
  ...overrides,
});

describe("extractFlag", () => {
  describe("flag extraction", () => {
    it("extracts flag value when present", () => {
      const args = ["--model", "/path/to/model", "--port", "8000"];
      expect(extractFlag(args, "--model")).toBe("/path/to/model");
      expect(extractFlag(args, "--port")).toBe("8000");
    });

    it("returns undefined when flag not present", () => {
      const args = ["--model", "/path/to/model"];
      expect(extractFlag(args, "--port")).toBeUndefined();
    });

    it("returns undefined when flag is last argument (no value)", () => {
      const args = ["--model", "/path/to/model", "--verbose"];
      expect(extractFlag(args, "--verbose")).toBeUndefined();
    });

    it("handles empty args array", () => {
      expect(extractFlag([], "--flag")).toBeUndefined();
    });

    it("handles flag with equals sign as separate value", () => {
      const args = ["--model", "path=value"];
      expect(extractFlag(args, "--model")).toBe("path=value");
    });

    it("returns first occurrence when flag appears multiple times", () => {
      const args = ["--model", "first", "--model", "second"];
      expect(extractFlag(args, "--model")).toBe("first");
    });
  });
});

describe("detectBackend", () => {
  describe("vLLM detection", () => {
    it("detects vLLM from entrypoints module path", () => {
      const args = ["python", "-m", "vllm.entrypoints.openai.api_server", "--model", "test"];
      expect(detectBackend(args)).toBe("vllm");
    });

    it("detects vLLM from serve command", () => {
      const args = ["vllm", "serve", "/path/to/model", "--port", "8000"];
      expect(detectBackend(args)).toBe("vllm");
    });

    it("detects vLLM from python vllm serve", () => {
      const args = ["python", "-m", "vllm", "serve", "model"];
      expect(detectBackend(args)).toBe("vllm");
    });
  });

  describe("SGLang detection", () => {
    it("detects SGLang from launch_server module", () => {
      const args = ["python", "-m", "sglang.launch_server", "--model", "test"];
      expect(detectBackend(args)).toBe("sglang");
    });
  });

  describe("TabbyAPI detection", () => {
    it("detects TabbyAPI from path", () => {
      const args = ["python", "/opt/tabbyAPI/main.py", "--config", "config.yml"];
      expect(detectBackend(args)).toBe("tabbyapi");
    });

    it("detects TabbyAPI from main.py with config flag", () => {
      const args = ["python", "main.py", "--config", "model.yml"];
      expect(detectBackend(args)).toBe("tabbyapi");
    });
  });

  describe("edge cases", () => {
    it("returns null for empty args", () => {
      expect(detectBackend([])).toBeNull();
    });

    it("returns null for unrecognized command", () => {
      const args = ["python", "some_script.py"];
      expect(detectBackend(args)).toBeNull();
    });

    it("returns null for generic python command", () => {
      const args = ["python", "-c", "print('hello')"];
      expect(detectBackend(args)).toBeNull();
    });
  });
});

describe("buildEnvironment", () => {
  describe("base environment", () => {
    it("includes FLASHINFER_DISABLE_VERSION_CHECK", () => {
      const recipe = createTestRecipe();
      const env = buildEnvironment(recipe);
      expect(env["FLASHINFER_DISABLE_VERSION_CHECK"]).toBe("1");
    });

    it("inherits from process.env", () => {
      const recipe = createTestRecipe();
      const env = buildEnvironment(recipe);
      // Should contain at least PATH from process.env
      expect(env["PATH"]).toBeDefined();
    });
  });

  describe("env_vars handling", () => {
    it("applies env_vars from recipe", () => {
      const recipe = createTestRecipe({
        env_vars: {
          CUSTOM_VAR: "custom_value",
          ANOTHER_VAR: "another_value",
        },
      });
      const env = buildEnvironment(recipe);
      expect(env["CUSTOM_VAR"]).toBe("custom_value");
      expect(env["ANOTHER_VAR"]).toBe("another_value");
    });

    it("converts non-string env_vars to strings", () => {
      const recipe = createTestRecipe({
        env_vars: {
          NUMBER_VAR: 123 as unknown as string,
          BOOL_VAR: true as unknown as string,
        },
      });
      const env = buildEnvironment(recipe);
      expect(env["NUMBER_VAR"]).toBe("123");
      expect(env["BOOL_VAR"]).toBe("true");
    });

    it("skips null and undefined env_vars", () => {
      const recipe = createTestRecipe({
        env_vars: {
          VALID: "value",
          NULL_VAR: null as unknown as string,
          UNDEFINED_VAR: undefined as unknown as string,
        },
      });
      const env = buildEnvironment(recipe);
      expect(env["VALID"]).toBe("value");
      expect(env["NULL_VAR"]).toBeUndefined();
      expect(env["UNDEFINED_VAR"]).toBeUndefined();
    });
  });

  describe("extra_args env_vars handling", () => {
    it("applies env_vars from extra_args (snake_case)", () => {
      const recipe = createTestRecipe({
        extra_args: {
          env_vars: {
            EXTRA_VAR: "extra_value",
          },
        },
      });
      const env = buildEnvironment(recipe);
      expect(env["EXTRA_VAR"]).toBe("extra_value");
    });

    it("applies env-vars from extra_args (kebab-case)", () => {
      const recipe = createTestRecipe({
        extra_args: {
          "env-vars": {
            KEBAB_VAR: "kebab_value",
          },
        },
      });
      const env = buildEnvironment(recipe);
      expect(env["KEBAB_VAR"]).toBe("kebab_value");
    });

    it("applies envVars from extra_args (camelCase)", () => {
      const recipe = createTestRecipe({
        extra_args: {
          envVars: {
            CAMEL_VAR: "camel_value",
          },
        },
      });
      const env = buildEnvironment(recipe);
      expect(env["CAMEL_VAR"]).toBe("camel_value");
    });
  });

  describe("CUDA_VISIBLE_DEVICES handling", () => {
    it("sets CUDA_VISIBLE_DEVICES from cuda_visible_devices", () => {
      const recipe = createTestRecipe({
        extra_args: {
          cuda_visible_devices: "0,1",
        },
      });
      const env = buildEnvironment(recipe);
      expect(env["CUDA_VISIBLE_DEVICES"]).toBe("0,1");
    });

    it("sets CUDA_VISIBLE_DEVICES from cuda-visible-devices (kebab)", () => {
      const recipe = createTestRecipe({
        extra_args: {
          "cuda-visible-devices": "2,3",
        },
      });
      const env = buildEnvironment(recipe);
      expect(env["CUDA_VISIBLE_DEVICES"]).toBe("2,3");
    });

    it("sets CUDA_VISIBLE_DEVICES from CUDA_VISIBLE_DEVICES (uppercase)", () => {
      const recipe = createTestRecipe({
        extra_args: {
          CUDA_VISIBLE_DEVICES: "0",
        },
      });
      const env = buildEnvironment(recipe);
      expect(env["CUDA_VISIBLE_DEVICES"]).toBe("0");
    });

    it("does not set CUDA_VISIBLE_DEVICES when value is false", () => {
      const originalCuda = process.env["CUDA_VISIBLE_DEVICES"];
      delete process.env["CUDA_VISIBLE_DEVICES"];

      const recipe = createTestRecipe({
        extra_args: {
          cuda_visible_devices: false as unknown as string,
        },
      });
      const env = buildEnvironment(recipe);
      expect(env["CUDA_VISIBLE_DEVICES"]).toBeUndefined();

      if (originalCuda !== undefined) {
        process.env["CUDA_VISIBLE_DEVICES"] = originalCuda;
      }
    });

    it("converts numeric CUDA_VISIBLE_DEVICES to string", () => {
      const recipe = createTestRecipe({
        extra_args: {
          cuda_visible_devices: 1 as unknown as string,
        },
      });
      const env = buildEnvironment(recipe);
      expect(env["CUDA_VISIBLE_DEVICES"]).toBe("1");
    });

    it("handles string CUDA_VISIBLE_DEVICES value of 0", () => {
      const recipe = createTestRecipe({
        extra_args: {
          cuda_visible_devices: "0",
        },
      });
      const env = buildEnvironment(recipe);
      expect(env["CUDA_VISIBLE_DEVICES"]).toBe("0");
    });
  });

  describe("precedence", () => {
    it("extra_args env_vars override recipe env_vars", () => {
      const recipe = createTestRecipe({
        env_vars: {
          SHARED_VAR: "from_recipe",
        },
        extra_args: {
          env_vars: {
            SHARED_VAR: "from_extra_args",
          },
        },
      });
      const env = buildEnvironment(recipe);
      expect(env["SHARED_VAR"]).toBe("from_extra_args");
    });
  });
});

describe("collectChildren", () => {
  describe("child collection", () => {
    it("collects direct children", () => {
      const tree = new Map<number, number[]>([
        [100, [101, 102, 103]],
      ]);
      const children = new Set<number>();
      collectChildren(tree, 100, children);
      expect(children).toEqual(new Set([101, 102, 103]));
    });

    it("collects nested children recursively", () => {
      const tree = new Map<number, number[]>([
        [100, [101]],
        [101, [102]],
        [102, [103]],
      ]);
      const children = new Set<number>();
      collectChildren(tree, 100, children);
      expect(children).toEqual(new Set([101, 102, 103]));
    });

    it("handles multiple branches", () => {
      const tree = new Map<number, number[]>([
        [100, [101, 102]],
        [101, [103, 104]],
        [102, [105]],
      ]);
      const children = new Set<number>();
      collectChildren(tree, 100, children);
      expect(children).toEqual(new Set([101, 102, 103, 104, 105]));
    });

    it("handles process with no children", () => {
      const tree = new Map<number, number[]>([
        [100, [101]],
      ]);
      const children = new Set<number>();
      collectChildren(tree, 999, children);
      expect(children.size).toBe(0);
    });

    it("handles empty tree", () => {
      const tree = new Map<number, number[]>();
      const children = new Set<number>();
      collectChildren(tree, 100, children);
      expect(children.size).toBe(0);
    });

    it("avoids infinite loops with circular references", () => {
      // This shouldn't happen in real process trees, but test defensive behavior
      const tree = new Map<number, number[]>([
        [100, [101]],
        [101, [102]],
        [102, [100]], // Circular reference back to 100
      ]);
      const children = new Set<number>();
      collectChildren(tree, 100, children);
      // Should collect all without infinite loop
      // Note: 100 gets added when encountered as child of 102
      expect(children).toEqual(new Set([100, 101, 102]));
    });

    it("preserves existing entries in accumulator", () => {
      const tree = new Map<number, number[]>([
        [100, [101]],
      ]);
      const children = new Set<number>([999]);
      collectChildren(tree, 100, children);
      expect(children).toEqual(new Set([999, 101]));
    });
  });
});

describe("readLogTail", () => {
  const testDir = "/tmp/process-utilities-test";
  const testFile = join(testDir, "test.log");

  beforeEach(() => {
    try {
      mkdirSync(testDir, { recursive: true });
    } catch {
      // Directory may already exist
    }
  });

  afterEach(() => {
    try {
      unlinkSync(testFile);
    } catch {
      // File may not exist
    }
    try {
      rmdirSync(testDir);
    } catch {
      // Directory may not be empty or not exist
    }
  });

  describe("file reading", () => {
    it("reads last N characters from file", () => {
      writeFileSync(testFile, "Hello World, this is a test log file.");
      const result = readLogTail(testFile, 10);
      expect(result).toBe(" log file.");
    });

    it("returns entire file if limit exceeds file size", () => {
      const content = "Short";
      writeFileSync(testFile, content);
      const result = readLogTail(testFile, 1000);
      expect(result).toBe(content);
    });

    it("handles empty file", () => {
      writeFileSync(testFile, "");
      const result = readLogTail(testFile, 100);
      expect(result).toBe("");
    });

    it("handles multi-line content", () => {
      writeFileSync(testFile, "Line 1\nLine 2\nLine 3\nLine 4");
      const result = readLogTail(testFile, 14);
      expect(result).toBe("\nLine 3\nLine 4");
    });
  });

  describe("error handling", () => {
    it("returns empty string for non-existent file", () => {
      const result = readLogTail("/tmp/non-existent-file-12345.log", 100);
      expect(result).toBe("");
    });

    it("returns empty string for non-existent directory", () => {
      const result = readLogTail("/non/existent/path/file.log", 100);
      expect(result).toBe("");
    });
  });

  describe("edge cases", () => {
    it("handles limit of 0", () => {
      writeFileSync(testFile, "Some content");
      const result = readLogTail(testFile, 0);
      expect(result).toBe("");
    });

    it("handles special characters in content", () => {
      const content = "Error: \u2500\u2500\u2500 Stack trace \u2500\u2500\u2500\n";
      writeFileSync(testFile, content);
      const result = readLogTail(testFile, 100);
      expect(result).toBe(content);
    });
  });
});
