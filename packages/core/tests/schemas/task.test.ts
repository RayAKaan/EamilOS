import { describe, it, expect } from "vitest";
import {
  TaskSchema,
  TaskStatusEnum,
  TaskTypeEnum,
  validateTaskTransition,
  TASK_TRANSITIONS,
} from "../../src/schemas/task.js";

describe("Task Schemas", () => {
  describe("TaskStatusEnum", () => {
    it("accepts all valid statuses", () => {
      const statuses = ["pending", "ready", "in_progress", "completed", "failed", "blocked", "waiting_approval", "cancelled", "interrupted"];
      for (const status of statuses) {
        const result = TaskStatusEnum.safeParse(status);
        expect(result.success).toBe(true);
      }
    });

    it("rejects invalid status", () => {
      const result = TaskStatusEnum.safeParse("invalid");
      expect(result.success).toBe(false);
    });
  });

  describe("TaskTypeEnum", () => {
    it("accepts all valid types", () => {
      const types = ["research", "coding", "qa", "planning", "design", "deploy", "custom"];
      for (const type of types) {
        const result = TaskTypeEnum.safeParse(type);
        expect(result.success).toBe(true);
      }
    });

    it("rejects invalid type", () => {
      const result = TaskTypeEnum.safeParse("invalid");
      expect(result.success).toBe(false);
    });
  });

  describe("TaskSchema", () => {
    it("validates minimal required fields", () => {
      const task = {
        id: "task-123",
        projectId: "proj-123",
        title: "Test Task",
        description: "Complete a test",
        type: "coding" as const,
        status: "pending" as const,
        dependsOn: [],
        artifacts: [],
        createdAt: new Date(),
      };
      const result = TaskSchema.safeParse(task);
      expect(result.success).toBe(true);
    });

    it("applies default values", () => {
      const task = {
        id: "task-123",
        projectId: "proj-123",
        title: "Test Task",
        description: "Complete a test",
        type: "coding" as const,
        status: "pending" as const,
        dependsOn: [],
        artifacts: [],
        createdAt: new Date(),
      };
      const result = TaskSchema.safeParse(task);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.priority).toBe("medium");
        expect(result.data.retryCount).toBe(0);
        expect(result.data.maxRetries).toBe(3);
        expect(result.data.requiresHumanApproval).toBe(false);
        expect(result.data.tokenUsage).toBe(0);
        expect(result.data.costUsd).toBe(0);
      }
    });

    it("accepts optional fields", () => {
      const task = {
        id: "task-123",
        projectId: "proj-123",
        title: "Test Task",
        description: "Complete a test",
        type: "coding" as const,
        status: "in_progress" as const,
        priority: "high" as const,
        dependsOn: ["task-001", "task-002"],
        artifacts: ["artifact-1", "artifact-2"],
        assignedAgent: "agent-001",
        requiredCapabilities: ["typescript", "react"],
        inputContext: "Previous task output",
        output: "Task result",
        retryCount: 1,
        maxRetries: 5,
        requiresHumanApproval: true,
        tokenUsage: 1000,
        costUsd: 0.05,
        error: "Previous error message",
        lockedBy: "agent-002",
        correlationId: "corr-123",
        parentTaskId: "task-parent",
        createdAt: new Date(),
        startedAt: new Date(),
        completedAt: new Date(),
      };
      const result = TaskSchema.safeParse(task);
      expect(result.success).toBe(true);
    });

    it("rejects empty id", () => {
      const task = {
        id: "",
        projectId: "proj-123",
        title: "Test Task",
        description: "Complete a test",
        type: "coding" as const,
        status: "pending" as const,
        dependsOn: [],
        artifacts: [],
        createdAt: new Date(),
      };
      const result = TaskSchema.safeParse(task);
      expect(result.success).toBe(false);
    });

    it("rejects empty projectId", () => {
      const task = {
        id: "task-123",
        projectId: "",
        title: "Test Task",
        description: "Complete a test",
        type: "coding" as const,
        status: "pending" as const,
        dependsOn: [],
        artifacts: [],
        createdAt: new Date(),
      };
      const result = TaskSchema.safeParse(task);
      expect(result.success).toBe(false);
    });

    it("rejects invalid priority", () => {
      const task = {
        id: "task-123",
        projectId: "proj-123",
        title: "Test Task",
        description: "Complete a test",
        type: "coding" as const,
        status: "pending" as const,
        priority: "invalid",
        dependsOn: [],
        artifacts: [],
        createdAt: new Date(),
      };
      const result = TaskSchema.safeParse(task);
      expect(result.success).toBe(false);
    });

    it("rejects negative retryCount", () => {
      const task = {
        id: "task-123",
        projectId: "proj-123",
        title: "Test Task",
        description: "Complete a test",
        type: "coding" as const,
        status: "pending" as const,
        retryCount: -1,
        dependsOn: [],
        artifacts: [],
        createdAt: new Date(),
      };
      const result = TaskSchema.safeParse(task);
      expect(result.success).toBe(false);
    });

    it("rejects negative cost", () => {
      const task = {
        id: "task-123",
        projectId: "proj-123",
        title: "Test Task",
        description: "Complete a test",
        type: "coding" as const,
        status: "pending" as const,
        costUsd: -0.01,
        dependsOn: [],
        artifacts: [],
        createdAt: new Date(),
      };
      const result = TaskSchema.safeParse(task);
      expect(result.success).toBe(false);
    });
  });

  describe("TASK_TRANSITIONS", () => {
    it("pending can transition to ready, blocked, cancelled", () => {
      expect(TASK_TRANSITIONS.pending).toContain("ready");
      expect(TASK_TRANSITIONS.pending).toContain("blocked");
      expect(TASK_TRANSITIONS.pending).toContain("cancelled");
    });

    it("in_progress has many possible transitions", () => {
      expect(TASK_TRANSITIONS.in_progress).toContain("completed");
      expect(TASK_TRANSITIONS.in_progress).toContain("failed");
      expect(TASK_TRANSITIONS.in_progress).toContain("ready");
      expect(TASK_TRANSITIONS.in_progress).toContain("waiting_approval");
      expect(TASK_TRANSITIONS.in_progress).toContain("interrupted");
    });

    it("completed has no transitions", () => {
      expect(TASK_TRANSITIONS.completed).toEqual([]);
    });
  });

  describe("validateTaskTransition", () => {
    it("allows valid transition pending -> ready", () => {
      expect(() => validateTaskTransition("pending", "ready")).not.toThrow();
    });

    it("allows valid transition in_progress -> completed", () => {
      expect(() => validateTaskTransition("in_progress", "completed")).not.toThrow();
    });

    it("throws on invalid transition pending -> completed", () => {
      expect(() => validateTaskTransition("pending", "completed")).toThrow(
        /Cannot transition task from "pending" to "completed"/
      );
    });

    it("throws when transitioning from completed", () => {
      expect(() => validateTaskTransition("completed", "ready")).toThrow();
    });

    it("allows failed -> ready for retry", () => {
      expect(() => validateTaskTransition("failed", "ready")).not.toThrow();
    });

    it("allows interrupted -> ready for retry", () => {
      expect(() => validateTaskTransition("interrupted", "ready")).not.toThrow();
    });
  });
});
