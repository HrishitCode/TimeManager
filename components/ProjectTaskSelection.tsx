"use client";

import { Project, Task } from "@/types/domain";

const NEW_PROJECT = "__new_project";
const NEW_TASK = "__new_task";

const formatDateTime24 = (value: string) =>
  new Date(value).toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

interface Props {
  projects: Project[];
  tasks: Task[];
  selectedProjectId: string;
  selectedTaskId: string;
  isCreatingProject: boolean;
  isCreatingTask: boolean;
  newProjectName: string;
  newProjectColor: string;
  newTaskTitle: string;
  error?: string;
  taskOptionalLabel?: string;
  disabled?: boolean;
  showSelectionDateTime?: boolean;
  selectionDateTime?: string;
  onSelectProject: (projectId: string) => void;
  onSelectTask: (taskId: string) => void;
  onSetIsCreatingProject: (value: boolean) => void;
  onSetIsCreatingTask: (value: boolean) => void;
  onSetNewProjectName: (value: string) => void;
  onSetNewProjectColor: (value: string) => void;
  onSetNewTaskTitle: (value: string) => void;
  onSetSelectionDateTime?: (value: string) => void;
  onCreateProject: () => Promise<void>;
  onCreateTask: () => Promise<void>;
}

export default function ProjectTaskSelection({
  projects,
  tasks,
  selectedProjectId,
  selectedTaskId,
  isCreatingProject,
  isCreatingTask,
  newProjectName,
  newProjectColor,
  newTaskTitle,
  error,
  taskOptionalLabel = "No task (project only)",
  disabled = false,
  showSelectionDateTime = false,
  selectionDateTime = "",
  onSelectProject,
  onSelectTask,
  onSetIsCreatingProject,
  onSetIsCreatingTask,
  onSetNewProjectName,
  onSetNewProjectColor,
  onSetNewTaskTitle,
  onSetSelectionDateTime,
  onCreateProject,
  onCreateTask
}: Props) {
  const projectTasks = tasks.filter((task) => task.project_id === selectedProjectId);
  const nowTime = (() => {
    const now = new Date();
    return `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
  })();
  const selectionDate = selectionDateTime ? selectionDateTime.slice(0, 10) : "";
  const selectionTime = selectionDateTime ? selectionDateTime.slice(11, 16) : nowTime;

  return (
    <>
      {error ? <p style={{ color: "#bf4342", marginTop: 8 }}>{error}</p> : null}

      <div className="row wrap" style={{ marginTop: 10 }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <label>Project</label>
          <select
            value={isCreatingProject ? NEW_PROJECT : selectedProjectId}
            disabled={disabled}
            onChange={(event) => {
              const value = event.target.value;
              if (value === NEW_PROJECT) {
                onSetIsCreatingProject(true);
                onSelectProject("");
                onSelectTask("");
                return;
              }
              onSetIsCreatingProject(false);
              onSelectProject(value);
            }}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
            <option value={NEW_PROJECT}>+ Create new project</option>
          </select>
        </div>
        {isCreatingProject || !selectedProjectId ? (
          <div className="row wrap" style={{ flex: 2, minWidth: 280 }}>
            <input
              placeholder="New project name"
              value={newProjectName}
              disabled={disabled}
              onChange={(event) => onSetNewProjectName(event.target.value)}
            />
            <input
              type="color"
              value={newProjectColor}
              disabled={disabled}
              onChange={(event) => onSetNewProjectColor(event.target.value)}
              style={{ width: 56 }}
            />
            <button className="primary" onClick={() => void onCreateProject()} disabled={disabled}>
              Add project
            </button>
          </div>
        ) : null}
      </div>

      <div className="row wrap" style={{ marginTop: 10 }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <label>Task (for selected project)</label>
          <select
            value={isCreatingTask ? NEW_TASK : selectedTaskId}
            disabled={disabled || !selectedProjectId}
            onChange={(event) => {
              const value = event.target.value;
              if (value === NEW_TASK) {
                onSetIsCreatingTask(true);
                onSelectTask("");
                return;
              }
              onSetIsCreatingTask(false);
              onSelectTask(value);
            }}
          >
            <option value="">{taskOptionalLabel}</option>
            {projectTasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
            <option value={NEW_TASK}>+ Create new task</option>
          </select>
        </div>
        {selectedProjectId && isCreatingTask ? (
          <div className="row wrap" style={{ flex: 2, minWidth: 280 }}>
            <input
              placeholder="New task title"
              value={newTaskTitle}
              disabled={disabled}
              onChange={(event) => onSetNewTaskTitle(event.target.value)}
            />
            <button className="primary" onClick={() => void onCreateTask()} disabled={disabled}>
              Add task
            </button>
          </div>
        ) : null}
      </div>

      {showSelectionDateTime ? (
        <div className="selection-time-block">
          <div className="selection-time-header">
            <label>Selection Time</label>
            <span className="muted">Defaults to now. Change if you want future booking.</span>
          </div>
          <div className="row wrap">
            <div className="selection-time-input-wrap" style={{ minWidth: 190 }}>
              <label>Date</label>
              <input
                className="selection-time-input"
                type="date"
                value={selectionDate}
                disabled={disabled}
                onChange={(event) => {
                  const datePart = event.target.value;
                  const timePart = selectionTime || nowTime;
                  onSetSelectionDateTime?.(datePart ? `${datePart}T${timePart}` : "");
                }}
              />
            </div>
            <div className="selection-time-input-wrap" style={{ minWidth: 140 }}>
              <label>Time</label>
              <input
                className="selection-time-input"
                type="time"
                step={900}
                value={selectionTime}
                disabled={disabled}
                onChange={(event) => {
                  const timePart = event.target.value;
                  const datePart = selectionDate || new Date().toISOString().slice(0, 10);
                  onSetSelectionDateTime?.(timePart ? `${datePart}T${timePart}` : `${datePart}T${nowTime}`);
                }}
              />
            </div>
          </div>
          <div className="selection-time-preview">
            {selectionDateTime ? formatDateTime24(selectionDateTime) : "No time selected"}
          </div>
        </div>
      ) : null}
    </>
  );
}
