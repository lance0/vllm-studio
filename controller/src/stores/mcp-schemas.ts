// CRITICAL
import { z } from "zod";

/**
 * Schema for POST /mcp/servers - Create a new MCP server.
 */
export const createMcpServerSchema = z.object({
  id: z.string(),
  name: z.string(),
  command: z.string(),
  enabled: z.boolean().default(true),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).default({}),
  description: z.string().optional(),
  url: z.string().optional(),
});

/**
 * Schema for PUT /mcp/servers/:serverId - Update an MCP server.
 */
export const updateMcpServerSchema = z.object({
  name: z.string().optional(),
  command: z.string().optional(),
  enabled: z.boolean().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  description: z.string().optional(),
  url: z.string().optional(),
});

/**
 * Schema for POST /mcp/tools/:serverId/:toolName - Call an MCP tool.
 */
export const toolCallArgumentsSchema = z.record(z.unknown()).default({});

export type CreateMcpServerInput = z.infer<typeof createMcpServerSchema>;
export type UpdateMcpServerInput = z.infer<typeof updateMcpServerSchema>;
export type ToolCallArgumentsInput = z.infer<typeof toolCallArgumentsSchema>;
