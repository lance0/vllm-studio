// CRITICAL
import type { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import type { AppContext } from "../types/context";
import { badRequest, notFound } from "../core/errors";
import {
  createChatSessionSchema,
  updateChatSessionSchema,
  addChatMessageSchema,
  forkChatSessionSchema,
} from "../stores/chat-schemas";

/**
 * Register chat session routes.
 * @param app - Hono app.
 * @param context - App context.
 */
export const registerChatsRoutes = (app: Hono, context: AppContext): void => {
  app.get("/chats", async (ctx) => {
    return ctx.json(context.stores.chatStore.listSessions());
  });

  app.get("/chats/:sessionId", async (ctx) => {
    const sessionId = ctx.req.param("sessionId");
    const session = context.stores.chatStore.getSession(sessionId);
    if (!session) {
      throw notFound("Session not found");
    }
    return ctx.json({ session });
  });

  app.post("/chats", async (ctx) => {
    try {
      const body = await ctx.req.json();
      const parsed = createChatSessionSchema.parse(body);
      const sessionId = randomUUID();
      const session = context.stores.chatStore.createSession(sessionId, parsed.title, parsed.model);
      return ctx.json({ session });
    } catch (error) {
      if (error instanceof ZodError) {
        throw badRequest(error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", "));
      }
      throw error;
    }
  });

  app.put("/chats/:sessionId", async (ctx) => {
    try {
      const sessionId = ctx.req.param("sessionId");
      const body = await ctx.req.json();
      const parsed = updateChatSessionSchema.parse(body);
      const updated = context.stores.chatStore.updateSession(sessionId, parsed.title, parsed.model);
      if (!updated) {
        throw notFound("Session not found");
      }
      return ctx.json({ success: true });
    } catch (error) {
      if (error instanceof ZodError) {
        throw badRequest(error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", "));
      }
      throw error;
    }
  });

  app.delete("/chats/:sessionId", async (ctx) => {
    const sessionId = ctx.req.param("sessionId");
    const deleted = context.stores.chatStore.deleteSession(sessionId);
    if (!deleted) {
      throw notFound("Session not found");
    }
    return ctx.json({ success: true });
  });

  app.post("/chats/:sessionId/messages", async (ctx) => {
    try {
      const sessionId = ctx.req.param("sessionId");
      const body = await ctx.req.json();
      const parsed = addChatMessageSchema.parse(body);
      const messageId = parsed.id ?? randomUUID();

      const message = context.stores.chatStore.addMessage(
        sessionId,
        messageId,
        parsed.role,
        parsed.content,
        parsed.model,
        parsed.tool_calls,
        parsed.request_prompt_tokens,
        parsed.request_tools_tokens,
        parsed.request_total_input_tokens,
        parsed.request_completion_tokens,
      );
      return ctx.json(message);
    } catch (error) {
      if (error instanceof ZodError) {
        throw badRequest(error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", "));
      }
      throw error;
    }
  });

  app.get("/chats/:sessionId/usage", async (ctx) => {
    const sessionId = ctx.req.param("sessionId");
    return ctx.json(context.stores.chatStore.getUsage(sessionId));
  });

  app.post("/chats/:sessionId/fork", async (ctx) => {
    try {
      const sessionId = ctx.req.param("sessionId");
      const body = await ctx.req.json();
      const parsed = forkChatSessionSchema.parse(body);
      const newId = randomUUID();
      const session = context.stores.chatStore.forkSession(
        sessionId,
        newId,
        parsed.message_id,
        parsed.model,
        parsed.title,
      );
      if (!session) {
        throw notFound("Session not found");
      }
      return ctx.json({ session });
    } catch (error) {
      if (error instanceof ZodError) {
        throw badRequest(error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", "));
      }
      throw error;
    }
  });
};
