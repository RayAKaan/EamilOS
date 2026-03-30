import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseManager } from "../src/db.js";
import { createTestContext } from "./helpers/test-workspace.js";
import type { ProjectCreate, TaskCreate } from "../src/index.js";

describe("DatabaseManager", () => {
  let db: DatabaseManager;
  let ctx: ReturnType<typeof createTestContext>;

  beforeEach(() => {
    ctx = createTestContext();
    db = new DatabaseManager(ctx.dbPath);
  });

  afterEach(() => {
    db.close();
    ctx.cleanup();
  });

  describe("Project operations", () => {
    it("creates a project", () => {
      const projectData: ProjectCreate = {
        name: "Test Project",
        goal: "Complete a task",
        path: "/workspace/test",
      };

      const project = db.createProject(projectData);

      expect(project.id).toBeDefined();
      expect(project.name).toBe("Test Project");
      expect(project.goal).toBe("Complete a task");
      expect(project.status).toBe("active");
      expect(project.path).toBe("/workspace/test");
      expect(project.totalTasks).toBe(0);
      expect(project.completedTasks).toBe(0);
      expect(project.failedTasks).toBe(0);
    });

    it("creates a project with optional fields", () => {
      const projectData: ProjectCreate = {
        name: "Test Project",
        goal: "Complete a task",
        path: "/workspace/test",
        userContext: "User wants to build a web app",
        constraints: ["must use React"],
        budgetUsd: 50.0,
      };

      const project = db.createProject(projectData);

      expect(project.userContext).toBe("User wants to build a web app");
      expect(project.constraints).toEqual(["must use React"]);
      expect(project.budgetUsd).toBe(50.0);
    });

    it("gets a project by id", () => {
      const projectData: ProjectCreate = {
        name: "Test Project",
        goal: "Complete a task",
        path: "/workspace/test",
      };

      const created = db.createProject(projectData);
      const retrieved = db.getProject(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.name).toBe(created.name);
    });

    it("returns null for non-existent project", () => {
      const project = db.getProject("non-existent-id");
      expect(project).toBeNull();
    });

    it("gets all projects", () => {
      db.createProject({ name: "Project 1", goal: "Goal 1", path: "/path1" });
      db.createProject({ name: "Project 2", goal: "Goal 2", path: "/path2" });

      const projects = db.getAllProjects();

      expect(projects.length).toBe(2);
    });

    it("updates project status", () => {
      const project = db.createProject({
        name: "Test Project",
        goal: "Complete a task",
        path: "/workspace/test",
      });

      db.updateProjectStatus(project.id, "paused");

      const updated = db.getProject(project.id);
      expect(updated?.status).toBe("paused");
    });

    it("throws on invalid project status transition", () => {
      const project = db.createProject({
        name: "Test Project",
        goal: "Complete a task",
        path: "/workspace/test",
      });

      expect(() => db.updateProjectStatus(project.id, "archived")).toThrow();
    });

    it("updates project budget", () => {
      const project = db.createProject({
        name: "Test Project",
        goal: "Complete a task",
        path: "/workspace/test",
      });

      db.updateProjectBudget(project.id, 500);

      const updated = db.getProject(project.id);
      expect(updated?.totalCostUsd).toBe(5);
    });
  });

  describe("Task operations", () => {
    let project: ReturnType<typeof db.createProject> extends Promise<infer T> ? T : ReturnType<typeof db.createProject>;

    beforeEach(() => {
      project = db.createProject({
        name: "Test Project",
        goal: "Complete a task",
        path: "/workspace/test",
      });
    });

    it("creates a task", () => {
      const taskData: TaskCreate = {
        projectId: project.id,
        title: "Test Task",
        description: "Complete a test",
        type: "coding",
      };

      const task = db.createTask(taskData);

      expect(task.id).toBeDefined();
      expect(task.projectId).toBe(project.id);
      expect(task.title).toBe("Test Task");
      expect(task.status).toBe("ready");
      expect(task.priority).toBe("medium");
    });

    it("creates a task with dependencies as pending", () => {
      const taskData: TaskCreate = {
        projectId: project.id,
        title: "Dependent Task",
        description: "Depends on another task",
        type: "coding",
        dependsOn: ["non-existent-task-id"],
      };

      const task = db.createTask(taskData);

      expect(task.status).toBe("pending");
      expect(task.dependsOn).toContain("non-existent-task-id");
    });

    it("creates a task with all optional fields", () => {
      const taskData: TaskCreate = {
        projectId: project.id,
        title: "Test Task",
        description: "Complete a test",
        type: "coding",
        priority: "high",
        dependsOn: [],
        requiredCapabilities: ["typescript", "react"],
        inputContext: "Previous context",
        requiresHumanApproval: true,
        maxRetries: 5,
      };

      const task = db.createTask(taskData);

      expect(task.priority).toBe("high");
      expect(task.requiredCapabilities).toEqual(["typescript", "react"]);
      expect(task.inputContext).toBe("Previous context");
      expect(task.requiresHumanApproval).toBe(true);
      expect(task.maxRetries).toBe(5);
    });

    it("gets a task by id", () => {
      const task = db.createTask({
        projectId: project.id,
        title: "Test Task",
        description: "Complete a test",
        type: "coding",
      });

      const retrieved = db.getTask(task.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(task.id);
    });

    it("returns null for non-existent task", () => {
      const task = db.getTask("non-existent-id");
      expect(task).toBeNull();
    });

    it("gets project tasks", () => {
      db.createTask({
        projectId: project.id,
        title: "Task 1",
        description: "Description 1",
        type: "coding",
      });
      db.createTask({
        projectId: project.id,
        title: "Task 2",
        description: "Description 2",
        type: "research",
      });

      const tasks = db.getProjectTasks(project.id);

      expect(tasks.length).toBe(2);
    });

    it("gets ready tasks", () => {
      const task1 = db.createTask({
        projectId: project.id,
        title: "Task 1",
        description: "No dependencies",
        type: "coding",
      });

      db.createTask({
        projectId: project.id,
        title: "Task 2",
        description: "Has dependencies",
        type: "coding",
        dependsOn: [task1.id],
      });

      const readyTasks = db.getReadyTasks(project.id);

      expect(readyTasks.length).toBe(1);
      expect(readyTasks[0].title).toBe("Task 1");
    });

    it("updates task status", () => {
      const task = db.createTask({
        projectId: project.id,
        title: "Test Task",
        description: "Complete a test",
        type: "coding",
      });

      db.updateTaskStatus(task.id, "in_progress");

      const updated = db.getTask(task.id);
      expect(updated?.status).toBe("in_progress");
      expect(updated?.startedAt).toBeDefined();
    });

    it("throws on invalid task status transition", () => {
      const task = db.createTask({
        projectId: project.id,
        title: "Test Task",
        description: "Complete a test",
        type: "coding",
      });

      expect(() => db.updateTaskStatus(task.id, "completed")).toThrow();
    });

    it("locks a task", () => {
      const task = db.createTask({
        projectId: project.id,
        title: "Test Task",
        description: "Complete a test",
        type: "coding",
      });

      const locked = db.lockTask(task.id, "agent-1");

      expect(locked).toBe(true);

      const updated = db.getTask(task.id);
      expect(updated?.lockedBy).toBe("agent-1");
    });

    it("fails to lock already locked task", () => {
      const task = db.createTask({
        projectId: project.id,
        title: "Test Task",
        description: "Complete a test",
        type: "coding",
      });

      db.lockTask(task.id, "agent-1");
      const locked = db.lockTask(task.id, "agent-2");

      expect(locked).toBe(false);
    });

    it("updates task with various fields", () => {
      const task = db.createTask({
        projectId: project.id,
        title: "Test Task",
        description: "Complete a test",
        type: "coding",
      });

      db.updateTask(task.id, {
        output: "Task output",
        artifacts: ["artifact-1", "artifact-2"],
        tokenUsage: 1000,
        costUsd: 0.05,
      });

      const updated = db.getTask(task.id);
      expect(updated?.output).toBe("Task output");
      expect(updated?.artifacts).toEqual(["artifact-1", "artifact-2"]);
      expect(updated?.tokenUsage).toBe(1000);
      expect(updated?.costUsd).toBe(0.05);
    });
  });

  describe("Artifact operations", () => {
    let project: ReturnType<typeof db.createProject> extends Promise<infer T> ? T : ReturnType<typeof db.createProject>;
    let task: ReturnType<typeof db.createTask> extends Promise<infer T> ? T : ReturnType<typeof db.createTask>;

    beforeEach(() => {
      project = db.createProject({
        name: "Test Project",
        goal: "Complete a task",
        path: "/workspace/test",
      });
      task = db.createTask({
        projectId: project.id,
        title: "Test Task",
        description: "Complete a test",
        type: "coding",
      });
    });

    it("inserts an artifact", () => {
      const artifact = db.insertArtifact({
        projectId: project.id,
        taskId: task.id,
        path: "/workspace/test/file.txt",
        hash: "abc123",
        size: 1024,
        type: "file",
        createdBy: "agent-1",
      });

      expect(artifact.id).toBeDefined();
      expect(artifact.path).toBe("/workspace/test/file.txt");
      expect(artifact.hash).toBe("abc123");
      expect(artifact.size).toBe(1024);
      expect(artifact.version).toBe(1);
    });

    it("gets project artifacts", () => {
      const task2 = db.createTask({
        projectId: project.id,
        title: "Test Task 2",
        description: "Complete a test",
        type: "coding",
      });

      db.insertArtifact({
        projectId: project.id,
        taskId: task.id,
        path: "/workspace/test/file1.txt",
        hash: "abc123",
        size: 1024,
        type: "file",
        createdBy: "agent-1",
      });
      db.insertArtifact({
        projectId: project.id,
        taskId: task2.id,
        path: "/workspace/test/file2.txt",
        hash: "def456",
        size: 2048,
        type: "file",
        createdBy: "agent-2",
      });

      const artifacts = db.getProjectArtifacts(project.id);

      expect(artifacts.length).toBe(2);
    });
  });

  describe("Event operations", () => {
    let project: ReturnType<typeof db.createProject> extends Promise<infer T> ? T : ReturnType<typeof db.createProject>;

    beforeEach(() => {
      project = db.createProject({
        name: "Test Project",
        goal: "Complete a task",
        path: "/workspace/test",
      });
    });

    it("creates an event", () => {
      const event = db.createEvent({
        type: "task.started",
        projectId: project.id,
        taskId: "task-1",
        agentId: "agent-1",
        data: { message: "Task started" },
        humanReadable: "Task started by agent-1",
      });

      expect(event.id).toBeDefined();
      expect(event.type).toBe("task.started");
      expect(event.projectId).toBe(project.id);
      expect(event.data.message).toBe("Task started");
    });

    it("gets project events", () => {
      db.createEvent({ type: "task.started", projectId: project.id });
      db.createEvent({ type: "task.completed", projectId: project.id });
      db.createEvent({ type: "task.started", projectId: project.id });

      const events = db.getProjectEvents(project.id);

      expect(events.length).toBe(3);
    });

    it("limits project events", () => {
      for (let i = 0; i < 10; i++) {
        db.createEvent({ type: "task.started", projectId: project.id });
      }

      const events = db.getProjectEvents(project.id, 5);

      expect(events.length).toBe(5);
    });

    it("gets decision events", () => {
      db.createEvent({ type: "decision.made", projectId: project.id, data: { decision: "Use React" } });
      db.createEvent({ type: "task.started", projectId: project.id });
      db.createEvent({ type: "decision.made", projectId: project.id, data: { decision: "Use TypeScript" } });

      const decisions = db.getDecisionEvents(project.id);

      expect(decisions.length).toBe(2);
      expect(decisions.every((e) => e.type === "decision.made")).toBe(true);
    });
  });
});
