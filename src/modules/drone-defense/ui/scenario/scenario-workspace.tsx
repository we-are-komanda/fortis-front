"use client";
import dynamic from "next/dynamic";
import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { PauseOutlined, PlayCircleOutlined, ReloadOutlined, PlusOutlined, MinusOutlined, ExpandOutlined, CloseOutlined } from "@ant-design/icons";
import libraryData from "../../infra/data/scenario/library-v1.json";
import { clockAt, formatTime, initialClock, transitionClock, validateLibrary, type ClockAction, type Exercise, type Library, type Track } from "../../domain/scenario-playback";
import { site, trackColors, workingZoom, type ScenarioLayers } from "../../domain/scenario-site";
import { factoryUnits, factoryCampusVersion, factoryCampusZoom } from "../../domain/factory-campus";
import { ScenarioMap2D } from "./scenario-map-2d";
import { SceneBoundary } from "./scene-boundary";
import styles from "./scenario.module.css";

const Scene3D = dynamic(() => import("./scenario-map-3d"), { ssr: false, loading: () => <p className={styles.loading} role="status">Загрузка 3D-сцены…</p> });
const FactorySite = dynamic(() => import("../factory-bim-viewer").then(module=>module.FactoryBimViewer), { ssr: false, loading: () => <p className={styles.loading} role="status">Подготовка предприятия…</p> });
const MassWorkspace = dynamic(() => import("./mass-scenario-workspace"), { ssr: false, loading: () => <p role="status">Подготовка массового прогона…</p> });
const tabLabels = { preparation: "Подготовка", playback: "Просмотр", comparison: "Сравнение" };
type Tab = keyof typeof tabLabels;


function readLibrary() {
  try {
    const result = validateLibrary(libraryData as Library);
    if (site.terrainVersion !== libraryData.scene.terrainVersion || site.enterpriseModelVersion !== libraryData.scene.enterpriseModelVersion) {
      return { ...result, sceneError: "Версии ассетов не совпадают с manifest площадки.", valid: [] };
    }
    return result;
  } catch { return null; }
}

export default function ScenarioWorkspace({ onExit }: { onExit: () => void }) {
  const { resolvedTheme } = useTheme();
  const [library, setLibrary] = useState(readLibrary);
  const [tab, setTab] = useState<Tab>("preparation");
  const [massOpen, setMassOpen] = useState(false);
  const [plantOpen, setPlantOpen] = useState(false);
  const [objectId, setObjectId] = useState("");
  const [selectedId, setSelectedId] = useState(library?.valid[0]?.exercise.id ?? "");
  const [rightId, setRightId] = useState<string | null>(null);
  const [clock, setClock] = useState(initialClock);
  const [view, setView] = useState<"2d" | "3d">("3d");
  const [ready, setReady] = useState(false);
  const [webglAvailable, setWebglAvailable] = useState<boolean | null>(null);
  const [sceneError, setSceneError] = useState(false);
  const [notice, setNotice] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [zoom, setZoom] = useState(workingZoom);
  const [fit, setFit] = useState(0);
  const [layers, setLayers] = useState<ScenarioLayers>({ terrain: true, enterprise: true, tracks: true, radius: true });
  const rendered3d = useRef(false);
  const act = useCallback((action: Omit<Extract<ClockAction, { type: "play" | "pause" | "reset" }>, "now">) => {
    const now = performance.now();
    setClock(current => transitionClock(current, { ...action, now }));
  }, []);
  const onReady = useCallback(() => { rendered3d.current = true; setReady(true); }, []);
  const onError = useCallback(() => {
    const now = performance.now();
    setClock(current => transitionClock(current, { type: "pause", now }));
    if (rendered3d.current) { setSceneError(true); setReady(false); }
    else { setView("2d"); setReady(true); setNotice("3D недоступен. Открыт пригодный для просмотра 2D-вид."); }
  }, []);
  useEffect(() => {
    if (view !== "3d") return;
    // R3F creates the renderer asynchronously; unsupported WebGL can fail before its error boundary.
    const frame = requestAnimationFrame(() => {
      let context: WebGL2RenderingContext | null = null;
      try { context = document.createElement("canvas").getContext("webgl2"); } catch { /* Unsupported renderer. */ }
      setWebglAvailable(!!context);
      if (context) context.getExtension("WEBGL_lose_context")?.loseContext();
      else onError();
    });
    return () => cancelAnimationFrame(frame);
  }, [view, onError]);
  const playing = clock.status === "playing";
  useEffect(() => {
    if (!playing) return;
    let frame: number;
    const tick = (now: number) => { startTransition(() => setClock(current => clockAt(current, now))); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
  useEffect(() => {
    const pauseHidden = () => {
      if (document.hidden) {
        const now = performance.now();
        setClock(current => transitionClock(current, { type: "pause", now }));
        setNotice("Воспроизведение приостановлено: вкладка была в фоне.");
      }
    };
    document.addEventListener("visibilitychange", pauseHidden);
    return () => document.removeEventListener("visibilitychange", pauseHidden);
  }, []);
  if (!library || library.sceneError) return <section className={styles.root}>
    <h1>Учебная площадка · синтетические данные</h1>
    <p role="alert">{library?.sceneError ?? "Не удалось прочитать библиотеку учебной площадки."}</p>
    <button onClick={() => setLibrary(readLibrary())}>Повторить</button><button onClick={onExit}>Вернуться к карте</button>
  </section>;
  if (massOpen) return <MassWorkspace onReturn={() => setMassOpen(false)} onExit={onExit} />;
  const selected = library.valid.find(entry => entry.exercise.id === selectedId);
  const right = library.valid.find(entry => entry.exercise.id === rightId);
  const tracks = [selected?.track, ...(tab === "comparison" ? [right?.track] : tab === "preparation" ? library.valid.filter(entry => entry.exercise.id !== selectedId).map(entry => entry.track) : [])].filter((track): track is Track => !!track);
  const switchTab = (next: Tab) => {
    setPlantOpen(false);
    act({ type: "pause" });
    if (next === "comparison" && !rightId) {
      const index = library.valid.findIndex(entry => entry.exercise.id === selectedId);
      setRightId(library.valid[(index + 1) % library.valid.length]?.exercise.id ?? null);
    }
    setTab(next);
  };
  const selectRecord = (id: string, side: "left" | "right" = "left") => {
    act({ type: tab === "comparison" ? "pause" : "reset" });
    if (side === "right") setRightId(id); else {
      setSelectedId(id);
      if (tab !== "comparison" && id === rightId) setRightId(null);
    }
  };
  const focus = (value: number) => { setZoom(value); setFit(f => f + 1); };
  const start = () => { act({ type: "reset" }); act({ type: "play" }); setTab("playback"); setNotice(""); };
  const seek = (timeMs: number) => { const now = performance.now(); setClock(current => transitionClock(current, { type: "seek", timeMs, now })); };
  const changeRate = (rate: 1 | 2 | 4) => { const now = performance.now(); setClock(current => transitionClock(current, { type: "rate", rate, now })); };
  const setMode = (mode: "2d" | "3d") => { if (mode === view) return; if (mode === "3d") setWebglAvailable(null); setView(mode); setReady(mode === "2d"); setSceneError(false); };
  const activeExercise = selected?.exercise;
  const statusLabel = { ready: "Готово к просмотру", paused: "Пауза", playing: "Воспроизведение", ended: "Упражнение завершено" }[clock.status];
  return <section className={styles.root} data-scenario-workspace data-time-ms={clock.timeMs} data-status={clock.status} data-zoom={zoom} data-enterprise-model={factoryCampusVersion}>
    <header className={styles.header}>
      <h1>Учебные сценарии</h1>
      <nav aria-label="Этап учебного просмотра" className={styles.tabs}>
        {(Object.entries(tabLabels) as [Tab, string][]).map(([id, title]) => <button key={id} aria-pressed={!plantOpen && tab === id} disabled={id === "comparison" && library.valid.length < 2} title={id === "comparison" && library.valid.length < 2 ? "Нужны две корректные записи" : undefined} onClick={() => switchTab(id)}>{title}</button>)}
        <button onClick={() => { act({ type: "pause" }); setMassOpen(true); }}>Массовый прогон</button>
        <button aria-pressed={plantOpen} onClick={() => { act({ type: "pause" }); setPlantOpen(true); }}>Предприятие</button>
      </nav>
      <button aria-label="К карте" onClick={() => { act({ type: "pause" }); onExit(); }} className={styles.exit}><CloseOutlined aria-hidden /> К карте</button>
    </header>
    <div className={styles.synthetic}>Factory BIM · 4 комплекса · учебная площадка <span>{factoryCampusVersion} · 320 × 320 м · окружение 10 км</span></div>
    {plantOpen ? <FactorySite campus unitId={objectId} onSelectUnit={setObjectId} onReturn={()=>setPlantOpen(false)}/> : <>
    <div className={styles.layout} data-columns={tab === "comparison" || aiOpen ? "three" : "two"}>
      <aside className={styles.library} aria-label="Настройки просмотра">
        {tab === "playback" && activeExercise && <EventList exercise={activeExercise} timeMs={clock.timeMs} />}
        <fieldset className={styles.section}><legend>Слои карты</legend>
          {(Object.entries({ terrain: "Рельеф", enterprise: "Предприятие", tracks: "Дорожки", radius: "Радиус 10 км" }) as [keyof ScenarioLayers, string][]).map(([id, label]) => <label className={styles.layer} key={id}><input type="checkbox" checked={layers[id]} onChange={e => setLayers(current => ({ ...current, [id]: e.target.checked }))} />{label}</label>)}
        </fieldset>
        <div className={styles.section}><button aria-expanded={aiOpen} onClick={() => setAiOpen(!aiOpen)}>AI-черновик</button><p>Следующий этап · без генерации</p></div>
        <details className={styles.section}><summary>Состав и происхождение</summary><p>Размерный макет · {factoryCampusVersion}</p>{factoryUnits.map(unit => <p key={unit.id}>{unit.id} · {unit.name}</p>)}<p>{(libraryData as Library).scene.authorNote}</p></details>
      </aside>
      <div className={styles.center}>
        <div className={styles.viewToolbar}>
          <div className={styles.viewPresets} aria-label="Масштаб сцены">
            <button aria-pressed={Math.abs(zoom-workingZoom)<.1} onClick={()=>focus(workingZoom)}>Рабочий вид</button>
            <button aria-pressed={Math.abs(zoom-factoryCampusZoom)<.1} onClick={()=>focus(factoryCampusZoom)}>Площадка 320 м</button>
            <button aria-pressed={zoom<2} onClick={()=>focus(1.1)}>Маршруты 10 км</button>
          </div>

        </div>
        {tab === "preparation" && activeExercise && <div className={styles.exerciseBrief}>
          <div><strong>{activeExercise.title} · 04:00 · 3 события</strong><p>{activeExercise.objective}</p></div>
          <button aria-label="Начать просмотр" className={styles.primary} disabled={!ready} onClick={start}><PlayCircleOutlined aria-hidden /> Начать просмотр</button>
        </div>}
        <div className={styles.stage} data-view={view}>
          <div className={styles.mapControls} aria-label="Управление видом">
            <button aria-pressed={view === "2d"} onClick={() => setMode("2d")}>2D</button><button aria-pressed={view === "3d"} disabled={webglAvailable === false} title={webglAvailable === false ? "WebGL недоступен" : undefined} onClick={() => setMode("3d")}>3D</button>
          </div>
          <div className={styles.zoomControls}>
            <button aria-label="Приблизить" onClick={() => setZoom(z => Math.min(128, z * 1.4))}><PlusOutlined /></button>
            <button aria-label="Отдалить" onClick={() => setZoom(z => Math.max(1, z / 1.4))}><MinusOutlined /></button>
            <button aria-label="Вписать площадку" title="Площадка 320 × 320 м" onClick={() => { setZoom(factoryCampusZoom); setFit(f => f + 1); }}><ExpandOutlined /></button>

          </div>
          {view === "2d" ? <ScenarioMap2D tracks={tracks} timeMs={clock.timeMs} layers={layers} zoom={zoom} preview={tab === "preparation"} selectedObject={objectId} onSelectObject={setObjectId} onFocusCampus={()=>focus(factoryCampusZoom)} /> : !sceneError && (webglAvailable === true ? <SceneBoundary onError={onError}><Scene3D tracks={tracks} timeMs={clock.timeMs} layers={layers} zoom={zoom} preview={tab === "preparation"} fit={fit} dark={resolvedTheme === "dark"} onReady={onReady} onError={onError} selectedObject={objectId} onSelectObject={setObjectId} onZoom={setZoom} onFocusCampus={()=>focus(factoryCampusZoom)} /></SceneBoundary> : <p className={styles.loading} role="status">Проверка доступности 3D…</p>)}
          {sceneError && <div className={styles.sceneMessage} role="alert"><h2>3D недоступен</h2><p>Просмотр приостановлен. Записи и время сохранены.</p><button onClick={() => setMode("2d")}>Открыть в 2D</button></div>}
          <div className={styles.sceneCaption}>Синтетическая местность · {zoom>=8?"площадка 320 × 320 м":"радиус 10 км"} · {view.toUpperCase()}</div>
        </div>
        <div className={styles.transport}>
          <div className={styles.transportRow}>
            <button className={styles.primary} aria-label={playing ? "Пауза" : clock.status === "ended" ? "Повторить" : "Воспроизвести"} disabled={!ready || !selected} onClick={() => { if (tab === "preparation") {setTab("playback");} act({ type: playing ? "pause" : "play" }); setNotice(""); }}>{playing ? <PauseOutlined /> : <PlayCircleOutlined />}{playing ? "Пауза" : clock.status === "ended" ? "Повторить" : "Пуск"}</button>
            <button aria-label="В начало" onClick={() => act({ type: "reset" })}><ReloadOutlined /></button>
            <output aria-label="Текущее учебное время" aria-live="off">{formatTime(clock.timeMs)} / 04:00</output>
            <label>Скорость просмотра <select aria-label="Скорость просмотра" value={clock.rate} onChange={e => changeRate(Number(e.target.value) as 1 | 2 | 4)}>{[1, 2, 4].map(rate => <option key={rate} value={rate}>{rate}×</option>)}</select></label>
            <span>{statusLabel}</span>
          </div>
          <label className={styles.timeline}>Учебное время<input aria-label="Учебное время" aria-valuetext={`${formatTime(clock.timeMs)} из 04:00`} type="range" min="0" max="240000" step="100" value={clock.timeMs} onPointerDown={() => act({ type: "pause" })} onChange={e => seek(Number(e.target.value))} /></label>
          <div className={styles.ticks}><span>00:00</span><span>01:00</span><span>02:00</span><span>03:00</span><span>04:00</span></div>
          {notice && <p role="status">{notice}</p>}
        </div>
        
      </div>
      {(tab === "comparison" || aiOpen) && <aside className={styles.right} aria-label="Сравнение и статус AI">
        {aiOpen && <div className={styles.section}><h2>AI-черновик</h2><p>Подключение NeuralDeep — следующий этап. Модель ещё не выбрана.</p><p>В SCN-01 генерация недоступна. Данные не отправляются провайдеру.</p><button onClick={() => setAiOpen(false)}>Закрыть AI-панель</button></div>}
        {tab === "comparison" && <div className={styles.section}><h2>Сравнение записей</h2><p>Общая шкала · одна камера</p>
          {(["left", "right"] as const).map(side => <label className={styles.pair} key={side}>{side === "left" ? "Левая запись" : "Правая запись"}<select aria-label={side === "left" ? "Левая запись" : "Правая запись"} value={side === "left" ? selectedId : rightId ?? ""} onChange={e => selectRecord(e.target.value, side)}>{library.entries.map(entry => <option key={entry.exercise.id} value={entry.exercise.id} disabled={!!entry.error || entry.exercise.id === (side === "left" ? rightId : selectedId)}>{entry.exercise.title}{entry.exercise.id === (side === "left" ? rightId : selectedId) ? " · уже выбрана" : entry.error ? " · недоступна" : ""}</option>)}</select></label>)}
          <p>Программа событий одинакова. Сравниваются подготовленные дорожки, оценка готовности не выполняется.</p>
          {[selected, right].map(entry => entry && <div className={styles.comparisonRecord} key={entry.exercise.id}><h3 style={{ color: `var(--track-${entry.track!.id}, ${trackColors[entry.track!.id]})` }}>{entry.exercise.title} · 04:00</h3><p>{entry.exercise.objective}</p><EventList exercise={entry.exercise} timeMs={clock.timeMs} /></div>)}
        </div>}
      </aside>}
    </div>
    <footer className={styles.footer}>План учебных событий · действия сотрудников не собираются. Физический расчёт не выполняется. Просмотр не сохраняется.</footer>
    </>}
  </section>;
}

function EventList({ exercise, timeMs }: { exercise: Exercise; timeMs: number }) {
  const currentIndex = exercise.events.reduce((last, event, index) => event.atMs <= timeMs ? index : last, -1);
  return <section className={styles.events} aria-label={`План учебных событий: ${exercise.title}`}><h3>План учебных событий</h3><ol>{exercise.events.map((event, index) => <li key={event.id} data-passed={event.atMs <= timeMs} aria-current={index === currentIndex ? "step" : undefined}><time>{formatTime(event.atMs)}</time><div><strong>{event.title}</strong><p>{event.text}</p><small>{event.atMs <= timeMs ? index === currentIndex ? "Текущее событие плана" : "Пройдено по шкале" : "Ожидается по плану"}</small></div></li>)}</ol></section>;
}
