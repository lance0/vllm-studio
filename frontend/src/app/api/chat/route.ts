import { NextRequest } from 'next/server';
import { normalizeToolArgumentsJson, mergeToolCallArguments } from '@/lib/tool-parsing';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
const API_KEY = process.env.API_KEY || '';

const BOX_TAGS_PATTERN = /<\|(?:begin|end)_of_box\|>/g;
const stripBoxTags = (text: string) => (text ? text.replace(BOX_TAGS_PATTERN, '') : text);

interface StreamEvent {
  type: 'text' | 'reasoning' | 'tool_calls' | 'done' | 'error';
  content?: string;
  tool_calls?: ToolCall[];
  error?: string;
}

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAIDelta {
  role?: string;
  content?: string | null;
  reasoning?: string | null;
  reasoning_content?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
}

type OpenAIToolCallDelta = NonNullable<OpenAIDelta['tool_calls']>[number];

interface OpenAIChunk {
  id: string;
  choices: Array<{
    index: number;
    delta: OpenAIDelta;
    finish_reason: string | null;
  }>;
}

const TOOL_CALL_START = '<tool_call>';
const TOOL_CALL_END = '</tool_call>';

const mergeStreamingText = (prevFull: string, incoming: string): { nextFull: string; emit: string } => {
  const prev = prevFull || '';
  const next = incoming || '';
  if (!next) return { nextFull: prev, emit: '' };
  if (!prev) return { nextFull: next, emit: next };

  if (next === prev) return { nextFull: prev, emit: '' };
  if (next.startsWith(prev)) return { nextFull: next, emit: next.slice(prev.length) };
  if (prev.startsWith(next)) return { nextFull: prev, emit: '' };
  if (prev.endsWith(next)) return { nextFull: prev, emit: '' };

  const maxOverlap = Math.min(prev.length, next.length);
  for (let k = maxOverlap; k > 0; k--) {
    const prefix = next.slice(0, k);
    if (prev.endsWith(prefix)) {
      const suffix = next.slice(k);
      return { nextFull: prev + suffix, emit: suffix };
    }
  }

  return { nextFull: prev + next, emit: next };
};

const parseToolCallBlock = (block: string, idx: number): ToolCall | null => {
  const inner = block
    .replace(TOOL_CALL_START, '')
    .replace(TOOL_CALL_END, '')
    .trim();
  if (!inner) return null;

  // GLM xml-style:
  // <tool_call>tool_name
  // {"json": "args"}
  // </tool_call>
  const lines = inner.split('\n');
  const firstLine = (lines[0] || '').trim();
  let name = firstLine;
  let argsRaw = lines.slice(1).join('\n').trim();

  // Also support single-line call form: tool_name({...})
  if (!argsRaw) {
    const m = firstLine.match(/^([a-zA-Z0-9_.:-]+)\s*\(([\s\S]*)\)\s*$/);
    if (m) {
      name = m[1];
      argsRaw = (m[2] || '').trim();
    }
  }

  if (!name) return null;
  const argumentsJson = normalizeToolArgumentsJson(argsRaw);

  return {
    id: `xml_call_${idx}`,
    type: 'function',
    function: {
      name,
      arguments: argumentsJson,
    },
  };
};

const parseInlineToolCall = (line: string, idx: number): ToolCall | null => {
  const trimmed = (line || '').trim();
  if (!trimmed.includes(TOOL_CALL_START)) return null;
  const after = trimmed.slice(trimmed.indexOf(TOOL_CALL_START) + TOOL_CALL_START.length).trim();
  if (!after) return null;

  // Expected: fnName({...}) or fnName([...]) or fnName("...") or fnName
  const m = after.match(/^([a-zA-Z0-9_.:-]+)\s*(?:\(([\s\S]*)\))?\s*$/);
  if (!m) return null;
  const name = m[1];
  const argsRaw = (m[2] || '').trim();
  const argumentsJson = normalizeToolArgumentsJson(argsRaw);

  return {
    id: `xml_call_${idx}`,
    type: 'function',
    function: { name, arguments: argumentsJson },
  };
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { messages, model, tools } = body;
    const xmlToolParsingEnabled = Array.isArray(tools) && tools.length > 0;

    console.log('[Chat API] Request:', {
      model,
      messageCount: messages?.length,
      toolCount: tools?.length,
    });

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'Messages required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Build request body for vLLM
    const requestBody: Record<string, unknown> = {
      model: model || 'default',
      messages,
      stream: true,
    };

    // Add tools if provided
    if (tools && tools.length > 0) {
      requestBody.tools = tools;
      requestBody.tool_choice = 'auto';
    }

    const incomingAuth = req.headers.get('authorization');
    const outgoingAuth = incomingAuth || (API_KEY ? `Bearer ${API_KEY}` : undefined);

    // Direct fetch to vLLM to capture reasoning_content field
    const response = await fetch(`${API_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(outgoingAuth ? { Authorization: outgoingAuth } : {}),
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Backend error ${response.status}: ${errorText}`);
    }

    const encoder = new TextEncoder();
    const sendEvent = (event: StreamEvent): Uint8Array => {
      return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
    };

    // Track tool calls being assembled (streaming deltas can split id/name/args)
    const toolCallsInProgress: Map<number, ToolCall> = new Map();
    let inReasoning = false;
    let toolsEmitted = false;
    let assistantContentFull = '';
    let assistantReasoningFull = '';

    // Parse/strip <tool_call> blocks that some models emit directly in text.
    let xmlContentBuffer = '';
    const xmlToolCalls: ToolCall[] = [];

    const consumeContentForXmlTools = (controller: ReadableStreamDefaultController, deltaText: string) => {
      if (!xmlToolParsingEnabled) {
        controller.enqueue(sendEvent({ type: 'text', content: deltaText }));
        return;
      }
      xmlContentBuffer += deltaText;

      while (true) {
        const startIdx = xmlContentBuffer.indexOf(TOOL_CALL_START);
        if (startIdx === -1) {
          if (xmlContentBuffer) {
            controller.enqueue(sendEvent({ type: 'text', content: xmlContentBuffer }));
            xmlContentBuffer = '';
          }
          return;
        }

        if (startIdx > 0) {
          const before = xmlContentBuffer.slice(0, startIdx);
          controller.enqueue(sendEvent({ type: 'text', content: before }));
          xmlContentBuffer = xmlContentBuffer.slice(startIdx);
        }

        const endIdx = xmlContentBuffer.indexOf(TOOL_CALL_END);
        if (endIdx === -1) {
          // Handle one-line tool calls that omit the closing tag:
          // <tool_call>tool_name({...})
          // Parse once we have a newline, otherwise wait for more.
          const nl = xmlContentBuffer.indexOf('\n');
          if (nl === -1) return;
          const firstLine = xmlContentBuffer.slice(0, nl);
          const parsed = parseInlineToolCall(firstLine, xmlToolCalls.length);
          if (parsed) xmlToolCalls.push(parsed);
          // Drop the tool call line from visible output
          xmlContentBuffer = xmlContentBuffer.slice(nl + 1);
          continue;
        }

        const block = xmlContentBuffer.slice(0, endIdx + TOOL_CALL_END.length);
        xmlContentBuffer = xmlContentBuffer.slice(endIdx + TOOL_CALL_END.length);
        const parsed = parseToolCallBlock(block, xmlToolCalls.length);
        if (parsed) xmlToolCalls.push(parsed);
      }
    };

    const upsertToolCallDelta = (tc: OpenAIToolCallDelta) => {
      const idx = tc.index;
      const existing =
        toolCallsInProgress.get(idx) ||
        ({
          id: tc.id || `call_${idx}`,
          type: 'function' as const,
          function: { name: tc.function?.name || '', arguments: tc.function?.arguments || '' },
        } satisfies ToolCall);

      if (tc.id && (existing.id.startsWith('call_') || !existing.id)) {
        existing.id = tc.id;
      }
      if (tc.function?.name) {
        existing.function.name = tc.function.name;
      }
      if (tc.function?.arguments) {
        existing.function.arguments = mergeToolCallArguments(
          existing.function.arguments,
          tc.function.arguments
        );
      }

      toolCallsInProgress.set(idx, existing);
    };

    const emitCompletedToolsIfAny = (controller: ReadableStreamDefaultController) => {
      if (toolsEmitted || toolCallsInProgress.size === 0) return;
      const completedTools = Array.from(toolCallsInProgress.entries())
        .sort(([a], [b]) => a - b)
        .map(([, v]) => v);
      controller.enqueue(sendEvent({ type: 'tool_calls', tool_calls: completedTools }));
      toolsEmitted = true;
    };

    const emitXmlToolsIfAny = (controller: ReadableStreamDefaultController) => {
      if (toolsEmitted) return;
      if (toolCallsInProgress.size > 0) return; // prefer structured tool_calls from backend
      if (xmlToolCalls.length === 0) return;
      controller.enqueue(sendEvent({ type: 'tool_calls', tool_calls: xmlToolCalls }));
      toolsEmitted = true;
    };

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const reader = response.body?.getReader();
          if (!reader) throw new Error('No response body');

          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const data = line.slice(6).trim();
              if (!data) continue;
              if (data === '[DONE]') {
                continue;
              }

              try {
                const chunk: OpenAIChunk = JSON.parse(data);
                const delta = chunk.choices[0]?.delta;
                if (!delta) continue;

                // Handle reasoning content (GLM, DeepSeek, etc.)
                const reasoning = delta.reasoning_content || delta.reasoning;
                if (reasoning) {
                  if (!inReasoning) {
                    // Start thinking block
                    controller.enqueue(sendEvent({ type: 'text', content: '<think>' }));
                    inReasoning = true;
                  }
                  const r = stripBoxTags(reasoning);
                  const merged = mergeStreamingText(assistantReasoningFull, r);
                  assistantReasoningFull = merged.nextFull;
                  if (merged.emit) controller.enqueue(sendEvent({ type: 'text', content: merged.emit }));
                }

                // Handle regular content
                if (delta.content) {
                  if (inReasoning) {
                    // Close thinking block before content
                    controller.enqueue(sendEvent({ type: 'text', content: '</think>\n\n' }));
                    inReasoning = false;
                  }
                  const c = stripBoxTags(delta.content);
                  const merged = mergeStreamingText(assistantContentFull, c);
                  assistantContentFull = merged.nextFull;
                  if (merged.emit) {
                    consumeContentForXmlTools(controller, merged.emit);
                  }
                }

                // Handle tool calls
                if (delta.tool_calls) {
                  for (const tc of delta.tool_calls) {
                    upsertToolCallDelta(tc);
                  }
                }

                // Check for finish
                if (chunk.choices[0]?.finish_reason) {
                  if (inReasoning) {
                    controller.enqueue(sendEvent({ type: 'text', content: '</think>\n\n' }));
                    inReasoning = false;
                  }

                  // Flush any remaining buffered text (including incomplete <tool_call> blocks)
                  if (xmlContentBuffer) {
                    // Best-effort parse any leftover one-line <tool_call> tags.
                    const leftoverLines = xmlContentBuffer.split('\n');
                    const kept: string[] = [];
                    for (const ln of leftoverLines) {
                      if (ln.includes(TOOL_CALL_START) && !ln.includes(TOOL_CALL_END)) {
                        const parsed = parseInlineToolCall(ln, xmlToolCalls.length);
                        if (parsed) {
                          xmlToolCalls.push(parsed);
                          continue;
                        }
                      }
                      kept.push(ln);
                    }
                    const remainingText = kept.join('\n');
                    if (remainingText) controller.enqueue(sendEvent({ type: 'text', content: remainingText }));
                    xmlContentBuffer = '';
                  }
                  emitCompletedToolsIfAny(controller);
                  emitXmlToolsIfAny(controller);
                }
              } catch {
                // Skip malformed JSON
              }
            }
          }

          if (inReasoning) {
            controller.enqueue(sendEvent({ type: 'text', content: '</think>\n\n' }));
            inReasoning = false;
          }
          if (xmlContentBuffer) {
            const leftoverLines = xmlContentBuffer.split('\n');
            const kept: string[] = [];
            for (const ln of leftoverLines) {
              if (ln.includes(TOOL_CALL_START) && !ln.includes(TOOL_CALL_END)) {
                const parsed = parseInlineToolCall(ln, xmlToolCalls.length);
                if (parsed) {
                  xmlToolCalls.push(parsed);
                  continue;
                }
              }
              kept.push(ln);
            }
            const remainingText = kept.join('\n');
            if (remainingText) controller.enqueue(sendEvent({ type: 'text', content: remainingText }));
            xmlContentBuffer = '';
          }
          emitCompletedToolsIfAny(controller);
          emitXmlToolsIfAny(controller);
          controller.enqueue(sendEvent({ type: 'done' }));
        } catch (error) {
          console.error('[Chat API] Stream error:', error);
          controller.enqueue(sendEvent({
            type: 'error',
            error: error instanceof Error ? error.message : String(error)
          }));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('[Chat API] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
