"use client";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { useTheme } from "next-themes";
import type { DefenseProject } from "@/shared/types/defense-project";
import { useDefenseProjectStore } from "@/shared/lib/use-defense-project-store";
import { buildProjectScenario } from "../../domain/project-scenario";
import { ScenarioMap2D } from "./scenario-map-2d";
import { SceneBoundary } from "./scene-boundary";
import styles from "./scenario.module.css";
const Scene3D = dynamic(() => import("./scenario-map-3d"), { ssr: false });
const noop = () => {};

export function ProjectSiteOverview({ project, onReturn }: { project: DefenseProject; onReturn: () => void }) {
  const scene = useMemo(() => buildProjectScenario(project), [project]);
  const [zoom, setZoom] = useState(scene.workingZoom);
  const [view, setView] = useState("3d");
  const { resolvedTheme } = useTheme();
  const selectObject = useDefenseProjectStore(state => state.selectObject);
  const props = { projectScene: scene, tracks: [], timeMs: 0, layers: { enterprise: true, terrain: false, tracks: false, radius: false }, zoom, preview: false, selectedObject: project.selectedObjectId, onSelectObject: selectObject };
  return <section className={styles.root} data-project-overview={scene.objectId}>
    <header className={styles.header}><h2>{scene.name}</h2><button onClick={onReturn}>К Монте-Карло</button></header>
    <div className={styles.stage} style={{ flex: 1 }}>
      <div className={styles.mapControls}><button aria-pressed={view === "2d"} onClick={() => setView("2d")}>2D</button><button aria-pressed={view === "3d"} onClick={() => setView("3d")}>3D</button></div>
      {view === "2d" ? <ScenarioMap2D {...props}/> : <SceneBoundary onError={() => setView("2d")}><Scene3D {...props} fit={0} dark={resolvedTheme === "dark"} onReady={noop} onError={() => setView("2d")} onZoom={setZoom}/></SceneBoundary>}
      <div className={styles.zoomControls}><button aria-label="Приблизить" onClick={() => setZoom(value => Math.min(128, value * 1.4))}>+</button><button aria-label="Отдалить" onClick={() => setZoom(value => Math.max(.01, value / 1.4))}>−</button></div>
      <div className={styles.sceneCaption}>Стандартная BIM-модель · {scene.placements.length} размещений с карты</div>
    </div>
  </section>;
}
