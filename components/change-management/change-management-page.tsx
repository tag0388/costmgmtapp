"use client";

import { useEffect, useState } from "react";
import { getProjectByPublicId, type Project } from "@/lib/projects";
import { listChangeOrders, listChangeRecords, changeManagementErrorMessage, type ChangeOrder, type ChangeRecord } from "@/lib/change-management";

export default function ChangeManagementPage({ projectPublicId }: { projectPublicId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [orders, setOrders] = useState<ChangeOrder[]>([]);
  const [records, setRecords] = useState<ChangeRecord[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const current = await getProjectByPublicId(projectPublicId);
        if (!active) return;
        setProject(current);
        if (!current) return;
        const [changeOrders, changeRecords] = await Promise.all([
          listChangeOrders(current.id),
          listChangeRecords(current.id),
        ]);
        if (!active) return;
        setOrders(changeOrders);
        setRecords(changeRecords);
      } catch (requestError) {
        if (active) setError(changeManagementErrorMessage(requestError));
      }
    })();
    return () => { active = false; };
  }, [projectPublicId]);

  return <div className="enterprise-admin-page">
    <div className="enterprise-page-title">
      <div>
        <h2>Change Management</h2>
        <p>{project ? `${project.project_code} · ${project.name}` : "Loading project…"}</p>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <span className="attribute-count">{orders.length} Change Orders</span>
        <span className="attribute-count">{records.length} Change Records</span>
      </div>
    </div>
    {error && <div className="data-message error"><strong>Unable to load Change Management</strong><span>{error}</span></div>}
  </div>;
}
