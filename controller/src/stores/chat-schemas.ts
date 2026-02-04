// CRITICAL
import { z } from "zod";

/**
 * Tool call schema for chat messages.
 */
export const toolCallSchema = z.object({
  id: z.string(),
  type: z.literal("function").optional(),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
});

/**
 * Schema for POST /chats - Create a new chat session.
 */
export const createChatSessionSchema = z.object({
  title: z.string().default("New Chat"),
  model: z.string().optional(),
});

/**
 * Schema for PUT /chats/:sessionId - Update a chat session.
 */
export const updateChatSessionSchema = z.object({
  title: z.string().optional(),
  model: z.string().optional(),
});

/**
 * Schema for POST /chats/:sessionId/messages - Add a message to a chat session.
 */
export const addChatMessageSchema = z.object({
  id: z.string().optional(),
  role: z.enum(["user", "assistant", "system", "tool"]).default("user"),
  content: z.string().optional(),
  model: z.string().optional(),
  tool_calls: z.array(toolCallSchema).optional(),
  request_prompt_tokens: z.number().int().optional(),
  request_tools_tokens: z.number().int().optional(),
  request_total_input_tokens: z.number().int().optional(),
  request_completion_tokens: z.number().int().optional(),
});

/**
 * Schema for POST /chats/:sessionId/fork - Fork a chat session.
 */
export const forkChatSessionSchema = z.object({
  message_id: z.string().optional(),
  model: z.string().optional(),
  title: z.string().optional(),
});

export type CreateChatSessionInput = z.infer<typeof createChatSessionSchema>;
export type UpdateChatSessionInput = z.infer<typeof updateChatSessionSchema>;
export type AddChatMessageInput = z.infer<typeof addChatMessageSchema>;
export type ForkChatSessionInput = z.infer<typeof forkChatSessionSchema>;
