// CRITICAL
import { describe, it, expect, beforeEach } from "vitest";
import { Event, EventManager, createEventManager } from "./event-manager";

describe("Event", () => {
  describe("constructor", () => {
    it("creates event with type and data", () => {
      const event = new Event("status", { ready: true });
      expect(event.type).toBe("status");
      expect(event.data).toEqual({ ready: true });
    });

    it("generates timestamp on creation", () => {
      const before = new Date().toISOString();
      const event = new Event("test", {});
      const after = new Date().toISOString();
      expect(event.timestamp >= before).toBe(true);
      expect(event.timestamp <= after).toBe(true);
    });

    it("generates unique id based on timestamp", () => {
      const event1 = new Event("test", {});
      const event2 = new Event("test", {});
      // IDs should be numeric strings
      expect(event1.id).toMatch(/^\d+$/);
      expect(event2.id).toMatch(/^\d+$/);
    });
  });

  describe("toSse", () => {
    it("formats event as SSE wire format", () => {
      const event = new Event("status", { ready: true, model: "test" });
      const sse = event.toSse();

      expect(sse).toContain(`id: ${event.id}\n`);
      expect(sse).toContain("event: status\n");
      expect(sse).toContain("data: ");
      expect(sse).toEndWith("\n\n");
    });

    it("includes data and timestamp in payload", () => {
      const event = new Event("gpu", { gpus: [{ id: 0 }] });
      const sse = event.toSse();

      // Parse the data line
      const dataMatch = sse.match(/data: (.+)\n/);
      expect(dataMatch).toBeTruthy();
      const payload = JSON.parse(dataMatch![1]);
      expect(payload.data).toEqual({ gpus: [{ id: 0 }] });
      expect(payload.timestamp).toBe(event.timestamp);
    });

    it("handles empty data object", () => {
      const event = new Event("heartbeat", {});
      const sse = event.toSse();
      expect(sse).toContain("data: ");
    });

    it("handles complex nested data", () => {
      const event = new Event("metrics", {
        nested: { deep: { value: 42 } },
        array: [1, 2, 3],
      });
      const sse = event.toSse();
      const dataMatch = sse.match(/data: (.+)\n/);
      const payload = JSON.parse(dataMatch![1]);
      expect(payload.data.nested.deep.value).toBe(42);
      expect(payload.data.array).toEqual([1, 2, 3]);
    });

    it("escapes special characters in JSON", () => {
      const event = new Event("test", { message: "line1\nline2" });
      const sse = event.toSse();
      // The newline should be escaped in JSON
      expect(sse).toContain('"line1\\nline2"');
    });
  });
});

describe("EventManager", () => {
  let manager: EventManager;

  beforeEach(() => {
    manager = createEventManager();
  });

  describe("getStats", () => {
    it("returns initial stats with zero events", () => {
      const stats = manager.getStats();
      expect(stats.total_events_published).toBe(0);
      expect(stats.total_subscribers).toBe(0);
      expect(stats.channels).toEqual({});
    });
  });

  describe("publish without subscribers", () => {
    it("does not throw when publishing without subscribers", async () => {
      // Should not throw
      await manager.publish(new Event("test", {}));
      const stats = manager.getStats();
      // Event not counted since no subscribers
      expect(stats.total_events_published).toBe(0);
    });

    it("publishStatus does not throw without subscribers", async () => {
      await manager.publishStatus({ ready: true });
      // Should complete without error
    });

    it("publishGpu does not throw without subscribers", async () => {
      await manager.publishGpu([{ id: 0, name: "GPU 0" }]);
      // Should complete without error
    });

    it("publishMetrics does not throw without subscribers", async () => {
      await manager.publishMetrics({ tps: 100 });
      // Should complete without error
    });

    it("publishLogLine does not throw without subscribers", async () => {
      await manager.publishLogLine("session-1", "test line");
      // Should complete without error
    });

    it("publishLaunchProgress does not throw without subscribers", async () => {
      await manager.publishLaunchProgress("recipe-1", "launching", "Starting...", 0.5);
      // Should complete without error
    });
  });
});

describe("createEventManager", () => {
  it("creates a new EventManager instance", () => {
    const manager = createEventManager();
    expect(manager).toBeInstanceOf(EventManager);
    expect(manager.getStats().total_events_published).toBe(0);
  });

  it("creates independent instances", () => {
    const manager1 = createEventManager();
    const manager2 = createEventManager();
    expect(manager1).not.toBe(manager2);
  });
});
