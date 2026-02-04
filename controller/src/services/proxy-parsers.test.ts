// CRITICAL
import { describe, it, expect, beforeEach } from "vitest";
import {
  cleanUtf8StreamContent,
  parseThinkTagsFromContent,
  fixMalformedToolCalls,
  parseToolCallsFromContent,
  type ThinkState,
  type ToolCallBuffer,
  type Utf8State,
} from "./proxy-parsers";

/**
 * Create a fresh UTF-8 state for tests.
 */
const createUtf8State = (): Utf8State => ({
  pendingContent: "",
  pendingReasoning: "",
});

/**
 * Create a fresh think state for tests.
 */
const createThinkState = (): ThinkState => ({
  inThinking: false,
});

/**
 * Create a fresh tool call buffer for tests.
 */
const createToolCallBuffer = (): ToolCallBuffer => ({
  content: "",
  tool_args: "",
  tool_name: "",
  has_malformed_tool_calls: false,
  tool_calls_found: false,
});

describe("cleanUtf8StreamContent", () => {
  let state: Utf8State;

  beforeEach(() => {
    state = createUtf8State();
  });

  describe("box-drawing character handling", () => {
    it("removes replacement char before box-drawing chars", () => {
      const result = cleanUtf8StreamContent("\uFFFD\u2500", state);
      expect(result).toBe("\u2500");
    });

    it("buffers box-drawing char followed by replacement (may recombine)", () => {
      // Trailing replacement char after box-drawing is buffered for potential recombination
      const result = cleanUtf8StreamContent("\u2500\uFFFD", state);
      expect(result).toBe("");
      expect(state.pendingContent).toBe("\u2500\uFFFD");
    });

    it("handles table corner patterns", () => {
      const result = cleanUtf8StreamContent("\u250C\uFFFD\u2500\u2500\u2510", state);
      expect(result).toBe("\u250C\u2500\u2500\u2510");
    });

    it("preserves valid box-drawing sequences", () => {
      const result = cleanUtf8StreamContent("\u250C\u2500\u2500\u2510", state);
      expect(result).toBe("\u250C\u2500\u2500\u2510");
    });

    it("buffers when ending with replacement chars (streaming context)", () => {
      // Trailing replacement chars are buffered for potential recombination with next chunk
      const result = cleanUtf8StreamContent("\uFFFD\uFFFD\u2500\uFFFD\uFFFD", state);
      expect(result).toBe("");
      expect(state.pendingContent).toBe("\uFFFD\uFFFD\u2500\uFFFD\uFFFD");
    });
  });

  describe("emoji/multi-byte handling", () => {
    it("buffers trailing replacement char for next chunk", () => {
      const result = cleanUtf8StreamContent("Hello\uFFFD", state);
      expect(result).toBe("");
      expect(state.pendingContent).toBe("Hello\uFFFD");
    });

    it("buffers partial byte suffix patterns", () => {
      const result = cleanUtf8StreamContent("Hello \uFFFD8f", state);
      expect(result).toBe("Hello ");
      expect(state.pendingContent).toBe("\uFFFD8f");
    });

    it("cleans corrupted emoji patterns mid-string", () => {
      const result = cleanUtf8StreamContent("Hello \uFFFD8f world", state);
      expect(result).toBe("Hello  world");
    });

    it("preserves valid text without corruption", () => {
      const result = cleanUtf8StreamContent("Hello world", state);
      expect(result).toBe("Hello world");
    });

    it("handles empty string input", () => {
      const result = cleanUtf8StreamContent("", state);
      expect(result).toBe("");
    });
  });

  describe("code context handling", () => {
    it("cleans replacement chars in backtick contexts", () => {
      const result = cleanUtf8StreamContent("`\uFFFD`", state);
      expect(result).toBe("``");
    });

    it("handles backtick-comma patterns", () => {
      const result = cleanUtf8StreamContent("`\uFFFD,", state);
      expect(result).toBe("`,");
    });

    it("handles backtick-paren patterns", () => {
      const result = cleanUtf8StreamContent("`\uFFFD)", state);
      expect(result).toBe("`)");
    });

    it("cleans replacement before backtick", () => {
      const result = cleanUtf8StreamContent("\uFFFD`", state);
      expect(result).toBe("`");
    });
  });

  describe("state management across chunks", () => {
    it("correctly prepends pending content from previous chunk", () => {
      // First chunk - buffers pending
      cleanUtf8StreamContent("Part one\uFFFD", state);
      expect(state.pendingContent).toBe("Part one\uFFFD");

      // Second chunk - prepends pending
      const result = cleanUtf8StreamContent("\u2500 continued", state);
      expect(result).toBe("Part one\u2500 continued");
      expect(state.pendingContent).toBe("");
    });

    it("clears pending content after use", () => {
      state.pendingContent = "buffered";
      const result = cleanUtf8StreamContent(" text", state);
      expect(result).toBe("buffered text");
      expect(state.pendingContent).toBe("");
    });
  });

  describe("punctuation cleanup", () => {
    it("cleans replacement chars after punctuation", () => {
      const result = cleanUtf8StreamContent("Hello,\uFFFD world", state);
      expect(result).toBe("Hello, world");
    });

    it("handles space + replacement patterns", () => {
      // The cleanup pattern normalizes " ﻿ " to "  " (two spaces)
      const result = cleanUtf8StreamContent("word \uFFFD\uFFFD word", state);
      expect(result).toBe("word  word");
    });
  });

  describe("orphaned replacement cleanup", () => {
    it("cleans orphaned replacement followed by word", () => {
      // Pattern like corrupted emoji leaving "�orid" where it should be "florid"
      const result = cleanUtf8StreamContent("\uFFFDorid", state);
      expect(result).toBe("orid");
    });
  });
});

describe("parseThinkTagsFromContent", () => {
  let state: ThinkState;

  beforeEach(() => {
    state = createThinkState();
  });

  /**
   * Helper to create SSE payload with delta content.
   */
  const createPayload = (content: string, reasoningContent?: string) => ({
    choices: [
      {
        delta: {
          content,
          ...(reasoningContent !== undefined && { reasoning_content: reasoningContent }),
        },
      },
    ],
  });

  describe("basic think tag extraction", () => {
    it("extracts content between <think> and </think> to reasoning_content", () => {
      const payload = createPayload("<think>reasoning here</think>output");
      const result = parseThinkTagsFromContent(payload, state);
      const delta = (result.choices as Array<{ delta: Record<string, unknown> }>)[0].delta;
      expect(delta.reasoning_content).toBe("reasoning here");
      expect(delta.content).toBe("output");
    });

    it("handles opening tag only (partial chunk)", () => {
      const payload = createPayload("<think>partial reasoning");
      const result = parseThinkTagsFromContent(payload, state);
      const delta = (result.choices as Array<{ delta: Record<string, unknown> }>)[0].delta;
      expect(delta.reasoning_content).toBe("partial reasoning");
      expect(delta.content).toBeNull();
      expect(state.inThinking).toBe(true);
    });

    it("handles multiple think blocks", () => {
      const payload = createPayload("<think>first</think>middle<think>second</think>end");
      // First extraction gets first block
      const result = parseThinkTagsFromContent(payload, state);
      const delta = (result.choices as Array<{ delta: Record<string, unknown> }>)[0].delta;
      expect(delta.reasoning_content).toBe("first");
    });
  });

  describe("state tracking across chunks", () => {
    it("tracks inThinking state when tag spans chunks", () => {
      // First chunk: open tag
      const payload1 = createPayload("<think>start of thinking");
      parseThinkTagsFromContent(payload1, state);
      expect(state.inThinking).toBe(true);

      // Second chunk: close tag
      const payload2 = createPayload("end of thinking</think>output");
      const result = parseThinkTagsFromContent(payload2, state);
      const delta = (result.choices as Array<{ delta: Record<string, unknown> }>)[0].delta;
      expect(delta.reasoning_content).toBe("end of thinking");
      expect(delta.content).toBe("output");
      expect(state.inThinking).toBe(false);
    });

    it("correctly sets inThinking=true on <think>", () => {
      const payload = createPayload("<think>thinking content");
      parseThinkTagsFromContent(payload, state);
      expect(state.inThinking).toBe(true);
    });

    it("correctly sets inThinking=false on </think>", () => {
      state.inThinking = true;
      const payload = createPayload("end thinking</think>regular");
      parseThinkTagsFromContent(payload, state);
      expect(state.inThinking).toBe(false);
    });

    it("handles content while inThinking is true", () => {
      state.inThinking = true;
      const payload = createPayload("continued thinking content");
      const result = parseThinkTagsFromContent(payload, state);
      const delta = (result.choices as Array<{ delta: Record<string, unknown> }>)[0].delta;
      expect(delta.reasoning_content).toBe("continued thinking content");
      expect(delta.content).toBeNull();
    });
  });

  describe("existing reasoning_content", () => {
    it("strips think tags from content when reasoning_content already present", () => {
      // When reasoning_content already exists, think tags are stripped but content between them remains
      const payload = createPayload("<think>in content</think>regular", "existing");
      const result = parseThinkTagsFromContent(payload, state);
      const delta = (result.choices as Array<{ delta: Record<string, unknown> }>)[0].delta;
      expect(delta.reasoning_content).toBe("existing");
      // The implementation strips the tags but keeps the content between them
      expect(delta.content).toBe("in contentregular");
    });
  });

  describe("edge cases", () => {
    it("handles </think> without prior <think> (orphan close)", () => {
      const payload = createPayload("before</think>after");
      const result = parseThinkTagsFromContent(payload, state);
      const delta = (result.choices as Array<{ delta: Record<string, unknown> }>)[0].delta;
      expect(delta.reasoning_content).toBe("before");
      expect(delta.content).toBe("after");
    });

    it("handles empty content between tags", () => {
      const payload = createPayload("<think></think>output");
      const result = parseThinkTagsFromContent(payload, state);
      const delta = (result.choices as Array<{ delta: Record<string, unknown> }>)[0].delta;
      expect(delta.reasoning_content).toBe("");
      expect(delta.content).toBe("output");
    });

    it("handles content before think tag", () => {
      const payload = createPayload("before<think>thinking</think>after");
      const result = parseThinkTagsFromContent(payload, state);
      const delta = (result.choices as Array<{ delta: Record<string, unknown> }>)[0].delta;
      expect(delta.reasoning_content).toBe("thinking");
      expect(delta.content).toBe("beforeafter");
    });

    it("returns payload unchanged if no choices array", () => {
      const payload = { data: "something" };
      const result = parseThinkTagsFromContent(payload, state);
      expect(result).toEqual(payload);
    });

    it("skips choices without delta/message", () => {
      const payload = { choices: [{ index: 0 }] };
      const result = parseThinkTagsFromContent(payload, state);
      expect(result).toEqual(payload);
    });

    it("handles empty content string", () => {
      const payload = createPayload("");
      const result = parseThinkTagsFromContent(payload, state);
      const delta = (result.choices as Array<{ delta: Record<string, unknown> }>)[0].delta;
      expect(delta.content).toBe("");
    });
  });
});

describe("fixMalformedToolCalls", () => {
  let buffer: ToolCallBuffer;

  beforeEach(() => {
    buffer = createToolCallBuffer();
  });

  /**
   * Helper to create SSE payload with tool calls.
   */
  const createToolCallPayload = (
    content: string,
    toolCalls: Array<{ function: { name: string; arguments: string } }>,
  ) => ({
    choices: [
      {
        delta: {
          content,
          tool_calls: toolCalls,
        },
      },
    ],
  });

  describe("missing function name", () => {
    it("extracts name from buffer content when tool_calls has empty name", () => {
      // Simulate buffered content containing the function name
      buffer.content = '{"name": "my_tool", "arguments": {}}';

      const payload = createToolCallPayload("", [{ function: { name: "", arguments: "{}" } }]);

      const result = fixMalformedToolCalls(payload, buffer);
      const delta = (result.choices as Array<{ delta: Record<string, unknown> }>)[0].delta;
      const toolCalls = delta.tool_calls as Array<{ function: { name: string } }>;
      expect(toolCalls[0].function.name).toBe("my_tool");
      expect(buffer.has_malformed_tool_calls).toBe(true);
    });

    it("handles whitespace-only name as empty", () => {
      buffer.content = '{"name": "extracted_tool"}';
      const payload = createToolCallPayload("", [{ function: { name: "   ", arguments: "{}" } }]);

      const result = fixMalformedToolCalls(payload, buffer);
      const delta = (result.choices as Array<{ delta: Record<string, unknown> }>)[0].delta;
      const toolCalls = delta.tool_calls as Array<{ function: { name: string } }>;
      expect(toolCalls[0].function.name).toBe("extracted_tool");
    });
  });

  describe("buffer tracking", () => {
    it("accumulates content in buffer", () => {
      const payload1 = createToolCallPayload("part1", []);
      fixMalformedToolCalls(payload1, buffer);
      expect(buffer.content).toBe("part1");

      const payload2 = createToolCallPayload("part2", []);
      fixMalformedToolCalls(payload2, buffer);
      expect(buffer.content).toBe("part1part2");
    });

    it("sets has_malformed_tool_calls flag appropriately", () => {
      expect(buffer.has_malformed_tool_calls).toBe(false);

      buffer.content = '{"name": "tool"}';
      const payload = createToolCallPayload("", [{ function: { name: "", arguments: "{}" } }]);
      fixMalformedToolCalls(payload, buffer);

      expect(buffer.has_malformed_tool_calls).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("returns payload unchanged if no choices array", () => {
      const payload = { data: "something" };
      const result = fixMalformedToolCalls(payload, buffer);
      expect(result).toEqual(payload);
    });

    it("preserves valid tool call names", () => {
      const payload = createToolCallPayload("", [{ function: { name: "valid_name", arguments: "{}" } }]);

      const result = fixMalformedToolCalls(payload, buffer);
      const delta = (result.choices as Array<{ delta: Record<string, unknown> }>)[0].delta;
      const toolCalls = delta.tool_calls as Array<{ function: { name: string } }>;
      expect(toolCalls[0].function.name).toBe("valid_name");
      expect(buffer.has_malformed_tool_calls).toBe(false);
    });
  });
});

describe("parseToolCallsFromContent", () => {
  describe("MCP tool format", () => {
    it("parses <use_mcp_tool> format with server_name, tool_name, arguments", () => {
      const content = `<use_mcp_tool>
        <server_name>myserver</server_name>
        <tool_name>my_tool</tool_name>
        <arguments>{"key": "value"}</arguments>
      </use_mcp_tool>`;

      const result = parseToolCallsFromContent(content);
      expect(result).toHaveLength(1);
      expect(result[0].function.name).toBe("my_tool");
      expect(result[0].function.arguments).toBe('{"key": "value"}');
      expect(result[0].type).toBe("function");
      expect(result[0].id).toMatch(/^call_/);
    });

    it("handles whitespace variations in MCP format", () => {
      const content = `<use_mcp_tool><server_name>s</server_name><tool_name>t</tool_name><arguments>{}</arguments></use_mcp_tool>`;
      const result = parseToolCallsFromContent(content);
      expect(result).toHaveLength(1);
      expect(result[0].function.name).toBe("t");
    });

    it("parses multiple MCP tool calls", () => {
      const content = `
        <use_mcp_tool><server_name>s</server_name><tool_name>tool1</tool_name><arguments>{}</arguments></use_mcp_tool>
        <use_mcp_tool><server_name>s</server_name><tool_name>tool2</tool_name><arguments>{}</arguments></use_mcp_tool>
      `;
      const result = parseToolCallsFromContent(content);
      expect(result).toHaveLength(2);
      expect(result[0].function.name).toBe("tool1");
      expect(result[1].function.name).toBe("tool2");
      expect(result[0].index).toBe(0);
      expect(result[1].index).toBe(1);
    });
  });

  describe("tool_call tag format", () => {
    it("parses </tool_call> suffix format", () => {
      const content = '{"name": "my_func", "arguments": {"x": 1}}</tool_call>';
      const result = parseToolCallsFromContent(content);
      expect(result).toHaveLength(1);
      expect(result[0].function.name).toBe("my_func");
      expect(result[0].function.arguments).toBe('{"x": 1}');
    });

    it("parses <tool_call>{json}</tool_call> format", () => {
      const content = '<tool_call>{"name": "func", "arguments": {"a": 1}}</tool_call>';
      const result = parseToolCallsFromContent(content);
      expect(result).toHaveLength(1);
      expect(result[0].function.name).toBe("func");
    });
  });

  describe("JSON-only format", () => {
    it("parses raw JSON with name and arguments fields", () => {
      const content = 'Some text {"name": "json_tool", "arguments": {"param": "value"}} more text';
      const result = parseToolCallsFromContent(content);
      expect(result).toHaveLength(1);
      expect(result[0].function.name).toBe("json_tool");
    });
  });

  describe("multiple tool calls", () => {
    it("extracts multiple tool calls from content", () => {
      const content = `
        {"name": "tool_a", "arguments": {}}
        {"name": "tool_b", "arguments": {"x": 1}}
      `;
      const result = parseToolCallsFromContent(content);
      expect(result).toHaveLength(2);
    });

    it("assigns sequential indices", () => {
      const content = `
        {"name": "a", "arguments": {}}
        {"name": "b", "arguments": {}}
        {"name": "c", "arguments": {}}
      `;
      const result = parseToolCallsFromContent(content);
      expect(result[0].index).toBe(0);
      expect(result[1].index).toBe(1);
      expect(result[2].index).toBe(2);
    });
  });

  describe("edge cases", () => {
    it("returns empty array for content without tool calls", () => {
      const result = parseToolCallsFromContent("Just regular text content");
      expect(result).toHaveLength(0);
    });

    it("handles empty content", () => {
      const result = parseToolCallsFromContent("");
      expect(result).toHaveLength(0);
    });

    it("generates unique tool call IDs", () => {
      const content = '{"name": "tool", "arguments": {}}';
      const result1 = parseToolCallsFromContent(content);
      const result2 = parseToolCallsFromContent(content);
      expect(result1[0].id).not.toBe(result2[0].id);
    });
  });
});
