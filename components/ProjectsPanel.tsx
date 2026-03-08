"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api/client";
import { Project } from "@/types/domain";

interface Props {
  token: string;
  projects: Project[];
  onRefresh: () => Promise<void>;
}

export default function ProjectsPanel({ token, projects, onRefresh }: Props) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#2364aa");

  const createProject = async () => {
    if (!name.trim()) {
      return;
    }
    await apiFetch<Project>("/api/projects", token, {
      method: "POST",
      body: JSON.stringify({ name, color })
    });
    setName("");
    await onRefresh();
  };

  return (
    <section className="card">
      <h2>Playgrounds (Projects)</h2>
      <div className="row wrap" style={{ marginTop: 10 }}>
        <input value={name} placeholder="Project name" onChange={(event) => setName(event.target.value)} />
        <input type="color" value={color} onChange={(event) => setColor(event.target.value)} style={{ width: 56 }} />
        <button className="primary" onClick={createProject}>
          Add
        </button>
      </div>

      <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
        {projects.map((project) => (
          <div key={project.id} className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <strong>{project.name}</strong>
            <span className="muted">{project.color}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
