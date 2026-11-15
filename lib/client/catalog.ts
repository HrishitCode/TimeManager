"use client";

import { useApi } from "./api";
import type { Project, Task } from "@/lib/shared/types";

/** Projects + tasks, shared by most screens. */
export const useCatalog = () => {
  const projects = useApi<Project[]>("/api/projects");
  const tasks = useApi<Task[]>("/api/tasks", { refreshMs: 60_000 });
  return {
    projects: projects.data ?? [],
    activeProjects: (projects.data ?? []).filter((p) => !p.archived_at),
    tasks: tasks.data ?? [],
    reloadProjects: projects.reload,
    reloadTasks: tasks.reload,
    setTasks: tasks.setData,
    loaded: projects.data !== undefined && tasks.data !== undefined
  };
};

export const projectColor = (projects: Project[], id: string | null | undefined, fallback = "var(--p1)") =>
  projects.find((p) => p.id === id)?.color ?? fallback;
