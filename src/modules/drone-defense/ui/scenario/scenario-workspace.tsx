"use client";
import dynamic from "next/dynamic";
import type { DefenseProject } from "@/shared/types/defense-project";
import { ProjectSiteOverview } from "./project-site-overview";
import { useState } from "react";
import { MenuOutlined } from "@ant-design/icons";
import styles from "./scenario.module.css";

const FactorySite = dynamic(() => import("../factory-bim-viewer").then(module => module.FactoryBimViewer), {
  ssr: false, loading: () => <p role="status">Подготовка предприятия…</p>,
});
const MassWorkspace = dynamic(() => import("./mass-scenario-workspace"), {
  ssr: false, loading: () => <p role="status">Подготовка моделирования…</p>,
});

export default function ScenarioWorkspace({ project }: { project?: DefenseProject }) {
  const [plantOpen, setPlantOpen] = useState(false);
  const [objectId, setObjectId] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const selectView = (enterprise: boolean) => { setPlantOpen(enterprise); setMenuOpen(false); };

  return <section className={`${styles.root} ${styles.workspace}`} data-scenario-workspace>
    <aside className={styles.submenu} aria-label="Раздел моделирования">
      <div className={styles.submenuHeading}>
        <h1>Моделирование</h1>
        <button className={styles.submenuToggle} aria-label="Меню моделирования" aria-expanded={menuOpen} aria-controls="scenario-submenu" onClick={() => setMenuOpen(!menuOpen)}><MenuOutlined aria-hidden /></button>
      </div>
      <div id="scenario-submenu" className={styles.submenuPanel} data-open={menuOpen}>
        <nav aria-label="Режим моделирования" className={styles.submenuNav}>
          <button aria-pressed={!plantOpen} onClick={() => selectView(false)}>Монте-Карло</button>
          <button aria-pressed={plantOpen} onClick={() => selectView(true)}>Предприятие</button>
        </nav>
      </div>
    </aside>
    <div className={styles.workspaceContent}>
      {plantOpen
        ? project ? <ProjectSiteOverview project={project} onReturn={() => selectView(false)} /> : <FactorySite campus unitId={objectId} onSelectUnit={setObjectId} onReturn={() => selectView(false)} />
        : <MassWorkspace key={project ? `${project.projectId}:${project.baseObject.id}` : "synthetic"} project={project} />}
    </div>
  </section>;
}
