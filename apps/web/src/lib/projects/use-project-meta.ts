"use client";

import { useEffect, useState } from "react";

export function useProjectMeta(projectId: string) {
  const [projectName, setProjectName] = useState(projectId);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}`)
      .then((response) => response.json())
      .then((payload: { project?: { name: string } }) => {
        if (!cancelled && payload.project?.name) setProjectName(payload.project.name);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return { projectName };
}
