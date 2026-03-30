import { describe, it, expect } from "vitest";
import {
  ProjectSchema,
  ProjectStatusEnum,
  validateProjectTransition,
  PROJECT_TRANSITIONS,
} from "../../src/schemas/project.js";

describe("Project Schemas", () => {
  describe("ProjectStatusEnum", () => {
    it("accepts valid statuses", () => {
      const statuses = ["active", "completed", "failed", "paused", "archived", "cancelled"];
      for (const status of statuses) {
        const result = ProjectStatusEnum.safeParse(status);
        expect(result.success).toBe(true);
      }
    });

    it("rejects invalid status", () => {
      const result = ProjectStatusEnum.safeParse("invalid");
      expect(result.success).toBe(false);
    });
  });

  describe("ProjectSchema", () => {
    it("validates minimal required fields", () => {
      const project = {
        id: "proj-123",
        name: "Test Project",
        goal: "Complete a task",
        status: "active" as const,
        path: "/workspace/test-project",
        createdAt: new Date(),
      };
      const result = ProjectSchema.safeParse(project);
      expect(result.success).toBe(true);
    });

    it("applies default values", () => {
      const project = {
        id: "proj-123",
        name: "Test Project",
        goal: "Complete a task",
        status: "active" as const,
        path: "/workspace/test-project",
        createdAt: new Date(),
      };
      const result = ProjectSchema.safeParse(project);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.totalTasks).toBe(0);
        expect(result.data.completedTasks).toBe(0);
        expect(result.data.failedTasks).toBe(0);
        expect(result.data.totalTokensUsed).toBe(0);
        expect(result.data.totalCostUsd).toBe(0);
      }
    });

    it("accepts optional userContext and constraints", () => {
      const project = {
        id: "proj-123",
        name: "Test Project",
        goal: "Complete a task",
        status: "active" as const,
        path: "/workspace/test-project",
        userContext: "User wants to build a web app",
        constraints: ["must use React", "must be responsive"],
        createdAt: new Date(),
      };
      const result = ProjectSchema.safeParse(project);
      expect(result.success).toBe(true);
    });

    it("accepts budget", () => {
      const project = {
        id: "proj-123",
        name: "Test Project",
        goal: "Complete a task",
        status: "active" as const,
        path: "/workspace/test-project",
        budgetUsd: 50.0,
        createdAt: new Date(),
      };
      const result = ProjectSchema.safeParse(project);
      expect(result.success).toBe(true);
    });

    it("rejects empty id", () => {
      const project = {
        id: "",
        name: "Test Project",
        goal: "Complete a task",
        status: "active" as const,
        path: "/workspace/test-project",
        createdAt: new Date(),
      };
      const result = ProjectSchema.safeParse(project);
      expect(result.success).toBe(false);
    });

    it("rejects empty name", () => {
      const project = {
        id: "proj-123",
        name: "",
        goal: "Complete a task",
        status: "active" as const,
        path: "/workspace/test-project",
        createdAt: new Date(),
      };
      const result = ProjectSchema.safeParse(project);
      expect(result.success).toBe(false);
    });

    it("rejects negative costs", () => {
      const project = {
        id: "proj-123",
        name: "Test Project",
        goal: "Complete a task",
        status: "active" as const,
        path: "/workspace/test-project",
        totalCostUsd: -5,
        createdAt: new Date(),
      };
      const result = ProjectSchema.safeParse(project);
      expect(result.success).toBe(false);
    });
  });

  describe("PROJECT_TRANSITIONS", () => {
    it("active can transition to completed, failed, paused, cancelled", () => {
      expect(PROJECT_TRANSITIONS.active).toContain("completed");
      expect(PROJECT_TRANSITIONS.active).toContain("failed");
      expect(PROJECT_TRANSITIONS.active).toContain("paused");
      expect(PROJECT_TRANSITIONS.active).toContain("cancelled");
    });

    it("archived has no transitions", () => {
      expect(PROJECT_TRANSITIONS.archived).toEqual([]);
    });
  });

  describe("validateProjectTransition", () => {
    it("allows valid transition", () => {
      expect(() => validateProjectTransition("active", "completed")).not.toThrow();
    });

    it("throws on invalid transition", () => {
      expect(() => validateProjectTransition("archived", "active")).toThrow(
        /Cannot transition project from "archived" to "active"/
      );
    });

    it("allows paused to active", () => {
      expect(() => validateProjectTransition("paused", "active")).not.toThrow();
    });

    it("throws when transitioning from completed", () => {
      expect(() => validateProjectTransition("completed", "active")).toThrow();
    });
  });
});
