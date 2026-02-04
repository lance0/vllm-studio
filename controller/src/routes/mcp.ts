// CRITICAL
import type { Hono } from "hono";
import { ZodError } from "zod";
import type { AppContext } from "../types/context";
import type { McpServer } from "../types/models";
import { badRequest, notFound, HttpStatus, safeErrorMessage } from "../core/errors";
import { runMcpCommand } from "../services/mcp-runner";
import { createMcpServerSchema, updateMcpServerSchema, toolCallArgumentsSchema } from "../stores/mcp-schemas";

/**
 * Register MCP routes.
 * @param app - Hono app.
 * @param context - App context.
 */
export const registerMcpRoutes = (app: Hono, context: AppContext): void => {
  /**
   * Sanitize tool arguments for known constraints.
   * @param toolName - Tool name.
   * @param args - Arguments object.
   * @returns Sanitized arguments.
   */
  const sanitizeToolArguments = (toolName: string, args: Record<string, unknown>): Record<string, unknown> => {
    const sanitized = { ...args };
    if (toolName === "get_code_context_exa") {
      const tokensNumber = Number(sanitized["tokensNum"] ?? 0);
      if (tokensNumber < 1000) {
        sanitized["tokensNum"] = 5000;
      }
    }
    return sanitized;
  };

  app.get("/mcp/servers", async (ctx) => {
    const enabledOnly = ctx.req.query("enabled_only") === "true";
    const servers = context.stores.mcpStore.list(enabledOnly);
    return ctx.json(servers);
  });

  app.get("/mcp/servers/:serverId", async (ctx) => {
    const serverId = ctx.req.param("serverId");
    const server = context.stores.mcpStore.get(serverId);
    if (!server) {
      throw notFound(`Server '${serverId}' not found`);
    }
    return ctx.json(server);
  });

  app.post("/mcp/servers", async (ctx) => {
    try {
      const body = await ctx.req.json();
      const parsed = createMcpServerSchema.parse(body);
      const server: McpServer = {
        id: parsed.id,
        name: parsed.name,
        enabled: parsed.enabled,
        command: parsed.command,
        args: parsed.args,
        env: parsed.env,
        description: parsed.description ?? null,
        url: parsed.url ?? null,
      };
      context.stores.mcpStore.save(server);
      return ctx.json(server);
    } catch (error) {
      if (error instanceof ZodError) {
        throw badRequest(error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", "));
      }
      throw error;
    }
  });

  app.put("/mcp/servers/:serverId", async (ctx) => {
    const serverId = ctx.req.param("serverId");
    const existing = context.stores.mcpStore.get(serverId);
    if (!existing) {
      throw notFound(`Server '${serverId}' not found`);
    }
    try {
      const body = await ctx.req.json();
      const parsed = updateMcpServerSchema.parse(body);
      const updated: McpServer = {
        id: serverId,
        name: parsed.name ?? existing.name,
        enabled: parsed.enabled ?? existing.enabled,
        command: parsed.command ?? existing.command,
        args: parsed.args ?? existing.args,
        env: parsed.env ?? existing.env,
        description: parsed.description !== undefined ? (parsed.description ?? null) : existing.description,
        url: parsed.url !== undefined ? (parsed.url ?? null) : existing.url,
      };
      context.stores.mcpStore.save(updated);
      return ctx.json(updated);
    } catch (error) {
      if (error instanceof ZodError) {
        throw badRequest(error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", "));
      }
      throw error;
    }
  });

  app.delete("/mcp/servers/:serverId", async (ctx) => {
    const serverId = ctx.req.param("serverId");
    const deleted = context.stores.mcpStore.delete(serverId);
    if (!deleted) {
      throw notFound(`Server '${serverId}' not found`);
    }
    return ctx.json({ status: "deleted", id: serverId });
  });

  app.post("/mcp/servers/:serverId/enable", async (ctx) => {
    const serverId = ctx.req.param("serverId");
    const updated = context.stores.mcpStore.setEnabled(serverId, true);
    if (!updated) {
      throw notFound(`Server '${serverId}' not found`);
    }
    return ctx.json({ status: "enabled", id: serverId });
  });

  app.post("/mcp/servers/:serverId/disable", async (ctx) => {
    const serverId = ctx.req.param("serverId");
    const updated = context.stores.mcpStore.setEnabled(serverId, false);
    if (!updated) {
      throw notFound(`Server '${serverId}' not found`);
    }
    return ctx.json({ status: "disabled", id: serverId });
  });

  app.get("/mcp/servers/:serverId/tools", async (ctx) => {
    const serverId = ctx.req.param("serverId");
    const server = context.stores.mcpStore.get(serverId);
    if (!server) {
      throw notFound(`Server '${serverId}' not found`);
    }
    if (!server.enabled) {
      throw badRequest(`Server '${serverId}' is disabled`);
    }
    try {
      const result = await runMcpCommand(server, "tools/list");
      const tools = Array.isArray(result["tools"]) ? result["tools"] : [];
      const withServer = tools.map((tool) => ({ ...tool, server: serverId }));
      return ctx.json({ server: serverId, tools: withServer });
    } catch (error) {
      throw new HttpStatus(500, safeErrorMessage(error));
    }
  });

  app.get("/mcp/tools", async (ctx) => {
    const servers = context.stores.mcpStore.list(true);
    const tools: Array<Record<string, unknown>> = [];
    const errors: Array<Record<string, unknown>> = [];
    for (const server of servers) {
      try {
        const result = await runMcpCommand(server, "tools/list");
        const serverTools = Array.isArray(result["tools"]) ? result["tools"] : [];
        for (const tool of serverTools) {
          tools.push({ ...tool, server: server.id });
        }
      } catch (error) {
        errors.push({ server: server.id, error: safeErrorMessage(error) });
      }
    }
    return ctx.json({ tools, errors: errors.length > 0 ? errors : null });
  });

  const callServerTool = async (
    serverId: string,
    toolName: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const server = context.stores.mcpStore.get(serverId);
    if (!server) {
      throw notFound(`Server '${serverId}' not found`);
    }
    if (!server.enabled) {
      throw badRequest(`Server '${serverId}' is disabled`);
    }
    const sanitized = sanitizeToolArguments(toolName, body);
    try {
      const result = await runMcpCommand(server, "tools/call", { name: toolName, arguments: sanitized });
      const content = Array.isArray(result["content"]) ? result["content"] : [];
      if (content.length > 0) {
        const textParts: string[] = [];
        for (const item of content) {
          if (item && typeof item === "object" && (item as Record<string, unknown>)["type"] === "text") {
            textParts.push(String((item as Record<string, unknown>)["text"] ?? ""));
          }
        }
        if (textParts.length > 0) {
          return { result: textParts.join("\n") };
        }
      }
      return { result };
    } catch (error) {
      throw new HttpStatus(500, safeErrorMessage(error));
    }
  };

  app.post("/mcp/servers/:serverId/tools/:toolName", async (ctx) => {
    const serverId = ctx.req.param("serverId");
    const toolName = ctx.req.param("toolName");
    let body: Record<string, unknown> = {};
    try {
      const rawBody = await ctx.req.json();
      body = toolCallArgumentsSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof ZodError) {
        throw badRequest(error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", "));
      }
      body = {};
    }
    const result = await callServerTool(serverId, toolName, body);
    return ctx.json(result);
  });

  app.post("/mcp/tools/:serverId/:toolName", async (ctx) => {
    const serverId = ctx.req.param("serverId");
    const toolName = ctx.req.param("toolName");
    let body: Record<string, unknown> = {};
    try {
      const rawBody = await ctx.req.json();
      body = toolCallArgumentsSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof ZodError) {
        throw badRequest(error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", "));
      }
      body = {};
    }
    const result = await callServerTool(serverId, toolName, body);
    return ctx.json(result);
  });
};
