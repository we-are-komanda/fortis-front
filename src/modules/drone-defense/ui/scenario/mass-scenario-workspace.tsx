"use client";
import dynamic from "next/dynamic";
import type { DefenseProject } from "@/shared/types/defense-project";
import { useDefenseProjectStore } from "@/shared/lib/use-defense-project-store";
import { buildProjectScenario } from "../../domain/project-scenario";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTheme } from "next-themes";
import { Button, Modal, Typography, theme } from "antd";
import libraryData from "../../infra/data/scenario/library-v1.json";
import { clockAt, formatTime, initialClock, transitionClock, type Clock, type ClockAction, type Library, type Track } from "../../domain/scenario-playback";
import { computeBatch, defaultMotionConfig, frameAt, generateRun, motionVersion, protectionRule, summarizeBatch, summarizeRun, sectorLabels, sectorColors, type MotionConfig, type RunSummary } from "../../domain/mass-motion";
import { factoryCampusZoom } from "../../domain/factory-campus";
import { workingZoom, type ScenarioLayers } from "../../domain/scenario-site";
import { ScenarioMap2D } from "./scenario-map-2d";
import { SceneBoundary } from "./scene-boundary";
import styles from "./scenario.module.css";

const Scene3D = dynamic(() => import("./scenario-map-3d"), { ssr: false, loading: () => <p role="status">Загрузка 3D…</p> });
const library = libraryData as Library;
const noReferenceTracks: Track[] = [];
const layerLabels = { terrain: "Рельеф", enterprise: "Предприятие", tracks: "Следы движения", radius: "Радиус 10 км" };

export default function MassScenarioWorkspace({ project }: { project?: DefenseProject }) {
  const projectScene = useMemo(() => project ? buildProjectScenario(project) : undefined, [project]);
  const protectionRadiusM = projectScene?.protectionRadiusM ?? protectionRule.radiusM;
  const siteZoom = projectScene?.workingZoom ?? workingZoom;
  const selectProjectObject = useDefenseProjectStore(state => state.selectObject);
  const { resolvedTheme } = useTheme();
  const { token } = theme.useToken();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [config, setConfig] = useState(defaultMotionConfig);
  const [seedText, setSeedText] = useState(String(defaultMotionConfig.seed));
  const [runIndex, setRunIndex] = useState(0);
  const [batchSize, setBatchSize] = useState(100);
  const [results, setResults] = useState<RunSummary[] | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const batch = useRef<AbortController | null>(null);
  const [clock, setClock] = useState<Clock>({ ...initialClock, rate: 30 });
  const [view, setView] = useState<"2d" | "3d">("3d");
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(projectScene?.workingZoom ?? 1.1);
  const [fit, setFit] = useState(0);
  const [objectId, setObjectId] = useState("");
  const [layers, setLayers] = useState<ScenarioLayers>({ terrain: true, enterprise: true, tracks: true, radius: true });
  const run = useMemo(() => generateRun(config, library, runIndex, protectionRadiusM), [config, runIndex, protectionRadiusM]);
  const summary = useMemo(() => summarizeRun(run), [run]);
  const aggregate = useMemo(() => results ? summarizeBatch(results) : null, [results]);
  const frame = useMemo(() => frameAt(run, clock.timeMs), [run, clock.timeMs]);
  const displayMarkers = useMemo(() => [...frame.markers, ...frame.signals], [frame]);
  const nextEventMs = Math.min(...run.objects.filter(object => object.endMs > clock.timeMs).map(object => object.endMs));
  const playing = clock.status === "playing";
  const validSeed = /^\d+$/.test(seedText) && Number(seedText) <= 0xffffffff;
  const time = (value: number) => formatTime(value, config.durationMs);
  const act = useCallback((action: Omit<Extract<ClockAction, { type: "play" | "pause" | "reset" }>, "now">) => {
    const now = performance.now();
    setClock(current => transitionClock(current, { ...action, now }, config.durationMs));
  }, [config.durationMs]);
  const onReady = useCallback(() => setReady(true), []);
  const onError = useCallback(() => {
    act({ type: "pause" }); setWebgl(false); setView("2d"); setReady(true);
    setNotice("3D недоступен. Открыт 2D, прогон и время сохранены.");
  }, [act]);
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      let context: WebGL2RenderingContext | null = null;
      try { context = document.createElement("canvas").getContext("webgl2"); } catch { /* Fall back below. */ }
      setWebgl(!!context);
      if (context) context.getExtension("WEBGL_lose_context")?.loseContext(); else onError();
    });
    return () => cancelAnimationFrame(id);
  }, [onError]);
  useEffect(() => {
    if (!playing) return;
    let id: number, last = 0;
    const tick = (now: number) => {
      if (now - last >= 1000 / 30) { setClock(current => clockAt(current, now, config.durationMs)); last = now; }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing, config.durationMs]);
  useEffect(() => {
    const pause = () => { if (document.hidden) act({ type: "pause" }); };
    document.addEventListener("visibilitychange", pause);
    return () => document.removeEventListener("visibilitychange", pause);
  }, [act]);
  useEffect(() => () => batch.current?.abort(), []);
  const cancel = () => { batch.current?.abort(); batch.current = null; setProgress(null); };
  const change = (patch: Partial<MotionConfig>) => {
    cancel(); setResults(null); setRunIndex(0); setNotice("");
    setClock(current => ({ ...initialClock, rate: current.rate }));
    setConfig(current => ({ ...current, ...patch }));
  };
  const calculate = async () => {
    cancel(); act({ type: "pause" }); setResults(null); setNotice(""); setProgress(0);
    const controller = new AbortController(); batch.current = controller;
    try {
      const next = await computeBatch(config, library, batchSize, controller.signal, setProgress, protectionRadiusM);
      if (!controller.signal.aborted) { setResults(next); setNotice(`Готово: ${next.length} прогонов. Выберите любой для просмотра.`); }
    } catch (error) {
      if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : "Ошибка расчёта.");
    } finally { if (batch.current === controller) { batch.current = null; setProgress(null); } }
  };
  const selectRun = (index: number) => { act({ type: "reset" }); setRunIndex(index); };
  const focus = (value: number) => { setZoom(value); setFit(current => current + 1); };
  const focusCampus = useCallback(() => { setZoom(siteZoom); setFit(current => current + 1); }, [siteZoom]);
  const seek = useCallback((value: number) => { const now = performance.now(); setClock(current => transitionClock(current, { type: "seek", timeMs: value, now }, config.durationMs)); }, [config.durationMs]);
  const selectedProjectPlacement = projectScene?.placements.find(object => object.id === project?.selectedObjectId);
  const sceneProps = { projectScene, protectionRadiusM, tracks: noReferenceTracks, markers: displayMarkers, timeMs: clock.timeMs, layers, zoom, preview: false, selectedObject: project ? project.selectedObjectId : objectId, onSelectObject: project ? selectProjectObject : setObjectId };
  const chart = useMemo(() => summary.curve.map((point, index) => `${index ? "H" : "M"}${(point.timeMs / config.durationMs * 600).toFixed(3)}${index ? "V" : ","}${(60 - point.active / Math.max(1, summary.peak) * 56).toFixed(3)}`).join(" "), [summary, config.durationMs]);
  return <section className={styles.root} data-mass-workspace data-project-id={project?.projectId} data-base-object-id={project?.baseObject.id} data-time-ms={clock.timeMs} data-status={clock.status} data-active={frame.markers.length} data-run={runIndex} data-seed={run.seed}>
    <header className={styles.header}><h2>Монте-Карло</h2><p>{projectScene?.name ?? "Массовое моделирование"}</p></header>
    <button className={styles.settingsToggle} aria-expanded={settingsOpen} aria-controls="mass-settings" onClick={() => setSettingsOpen(open => !open)}>{settingsOpen ? "Скрыть настройки · к сцене" : "Параметры и результаты Монте-Карло"}</button>
    <div className={`${styles.layout} ${styles.massLayout}`} data-settings-open={settingsOpen}>
      <aside id="mass-settings" className={styles.library} aria-label="Настройки массового прогона">
        <div className={styles.section}><h2>Параметры прогона</h2>
          <label className={styles.pair}><span className={styles.sliderLabel}>Длительность <strong>{config.durationMs / 60000} мин</strong></span><input type="range" aria-label="Длительность" aria-valuetext={`${config.durationMs / 60000} минут`} min="30" max="90" step="1" value={config.durationMs / 60000} onChange={e => change({ durationMs: Number(e.target.value) * 60000 })} /><span className={styles.ticks} aria-hidden><span>30 мин</span><span>90 мин</span></span></label>
          <label className={styles.pair}><span className={styles.sliderLabel}>Всего объектов <strong>{config.count}</strong></span><input type="range" aria-label="Всего объектов" min="100" max="500" step="1" value={config.count} onChange={e => change({ count: Number(e.target.value) })} /><span className={styles.ticks} aria-hidden><span>100</span><span>500</span></span></label>
          <label className={styles.pair}>Seed<input className={styles.numberInput} inputMode="numeric" value={seedText} aria-invalid={!validSeed} onChange={e => { const text = e.target.value; setSeedText(text); if (/^\d+$/.test(text) && Number(text) <= 0xffffffff) change({ seed: Number(text) }); else { cancel(); selectRun(0); setResults(null); } }} /></label>
          {!validSeed && <p role="alert">Введите целое число от 0 до 4294967295. Пока отображается seed {config.seed}.</p>}
          <label className={styles.layer}><input type="checkbox" checked={config.scatter > 0} onChange={e => change({ scatter: e.target.checked ? .25 : 0 })} />Неравномерно по времени</label>
          <p>{config.scatter > 0 ? "Интервалы появления и длительность движения меняются от прогона к прогону." : "Объекты появляются через равные интервалы. Направления остаются случайными."}</p>
        </div>
        <div className={styles.section}><h2>Монте-Карло</h2>
          <label className={styles.pair}>Размер пакета<select aria-label="Размер пакета" value={batchSize} onChange={e => { cancel(); selectRun(0); setResults(null); setBatchSize(Number(e.target.value)); setNotice(""); }}>{[100, 500].map(n => <option key={n} value={n}>{n} прогонов</option>)}</select></label>
          <div className={styles.batchActions}><button className={styles.primary} disabled={progress !== null || !validSeed} onClick={calculate}>Рассчитать пакет</button>{progress !== null && <button onClick={() => { cancel(); setNotice("Расчёт отменён. Частичные результаты не сохранены."); }}>Отменить</button>}</div>
          {progress !== null && <div role="status"><progress max={batchSize} value={progress} aria-label="Прогресс расчёта" /> {progress} / {batchSize}</div>}
          {aggregate && <div data-batch-result><p>Пики активных · {results!.length} прогонов</p><dl className={styles.batchStats}>{Object.entries({ Минимум: aggregate.min, Медиана: aggregate.median, p90: aggregate.p90, Максимум: aggregate.max }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><p>Средняя одновременная нагрузка: {aggregate.meanActive.toFixed(1)} объекта. p90 — квантиль пиков, не вероятность воздействия.</p></div>}
          <p role="status">{notice}</p>
        </div>
        <fieldset className={styles.section}><legend>Слои карты</legend>{(Object.entries(layerLabels) as [keyof ScenarioLayers, string][]).filter(([key]) => !projectScene || key !== "terrain").map(([key, label]) => <label className={styles.layer} key={key}><input type="checkbox" checked={layers[key]} onChange={e => setLayers(current => ({ ...current, [key]: e.target.checked }))} />{projectScene && key === "enterprise" ? "Объект и средства" : label}</label>)}</fieldset>
      </aside>
      <div className={styles.center}>
        <div className={styles.viewToolbar}>
          <button aria-haspopup="dialog" onClick={() => setReferenceOpen(true)}>Справочная информация</button>
          {projectScene && <button onClick={focusCampus}>Объект и средства · {projectScene.placements.length}</button>}
          <label className={styles.runSelect}>Прогон<select aria-label="Номер прогона" value={runIndex} onChange={e => selectRun(Number(e.target.value))}>{Array.from({ length: results?.length ?? 1 }, (_, index) => <option value={index} key={index}>№{index + 1}{results ? ` · пик ${results[index].peak}` : " · предварительный"}</option>)}</select></label>
        </div>
        {zoom >= 8 && <p className={styles.offscreen}>Дальние объекты вне кадра. Здесь видны подход к предприятию и условные срабатывания на зелёной границе.</p>}
        <div className={styles.motionCounters} aria-label="Состояние объектов"><span>Ожидают <strong data-waiting>{frame.waiting}</strong></span><span>Активны <strong>{frame.markers.length}</strong></span><span>Условные срабатывания <strong data-finished>{frame.finished}</strong></span><span>Пик прогона <strong>{summary.peak}</strong></span></div>
        <div className={styles.stage} data-view={view}>
          <div className={styles.mapControls}><button aria-label="Приблизить к объекту" title="Приблизить к объекту" onClick={() => focus(factoryCampusZoom)}>К объекту</button><button aria-pressed={view === "2d"} onClick={() => { setView("2d"); setReady(true); }}>2D</button><button aria-pressed={view === "3d"} disabled={webgl === false} onClick={() => { if (view !== "3d") { setReady(false); setView("3d"); } }}>3D</button></div>
          {view === "2d" ? <ScenarioMap2D {...sceneProps} /> : webgl && <SceneBoundary onError={onError}><Scene3D {...sceneProps} fit={fit} dark={resolvedTheme === "dark"} onReady={onReady} onError={onError} onZoom={setZoom} /></SceneBoundary>}
          <div className={styles.zoomControls}><button aria-label="Приблизить" onClick={() => setZoom(z => Math.min(128, z * 1.4))}>+</button><button aria-label="Отдалить" onClick={() => setZoom(z => Math.max(projectScene ? .01 : 1, z / 1.4))}>−</button><button aria-label="Вписать обзор 360°" onClick={() => focus(1.1)}>↔</button></div>
          <div className={styles.sceneCaption}>{selectedProjectPlacement && <strong>{selectedProjectPlacement.name} · {selectedProjectPlacement.quantity} шт.</strong>}Зелёный контур — условная зона защиты · {view.toUpperCase()}{frame.signals.length > 0 && <strong data-protection-notice>Условное срабатывание · объект {frame.events[0].id + 1} · {time(frame.events[0].endMs)}</strong>}</div>
        </div>
        <div className={styles.transport}>
          <div className={styles.transportRow}><button className={styles.primary} disabled={!ready || !validSeed} onClick={() => act({ type: playing ? "pause" : "play" })}>{playing ? "Пауза" : clock.status === "ended" ? "Повторить" : "Пуск"}</button><button onClick={() => act({ type: "reset" })}>В начало</button><output aria-label="Время массового прогона">{time(clock.timeMs)} / {time(config.durationMs)}</output><label>Скорость<select aria-label="Скорость просмотра" value={clock.rate} onChange={e => { const rate = Number(e.target.value) as Clock["rate"], now = performance.now(); setClock(current => transitionClock(current, { type: "rate", rate, now }, config.durationMs)); }}>{[1, 10, 30, 60].map(rate => <option value={rate} key={rate}>{rate}×</option>)}</select></label></div>
          <label className={styles.timeline}>Время сценария<input type="range" aria-label="Время сценария" aria-valuetext={time(clock.timeMs)} min="0" max={config.durationMs} step="1000" value={clock.timeMs} onPointerDown={() => act({ type: "pause" })} onChange={e => seek(Number(e.target.value))} /></label>
          <button disabled={!Number.isFinite(nextEventMs) || !validSeed} onClick={() => { seek(nextEventMs); focusCampus(); }}>К следующему срабатыванию</button>
          <svg className={styles.loadChart} viewBox="0 0 600 64" preserveAspectRatio="none" role="img" aria-label={`Активные объекты во времени: пик ${summary.peak}, среднее ${summary.mean.toFixed(1)}`}><path d={chart} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /><line x1={clock.timeMs / config.durationMs * 600} x2={clock.timeMs / config.durationMs * 600} y1="0" y2="64" stroke="var(--ink)" strokeDasharray="3 3" /></svg>
          <div className={styles.ticks}><span>00:00</span><span>Активных: 0–{summary.peak} · среднее {summary.mean.toFixed(1)}</span><span>{time(config.durationMs)}</span></div>
        </div>
      </div>
    </div>
    <Modal title="Справочная информация" open={referenceOpen} onCancel={() => setReferenceOpen(false)} footer={null} width={520} styles={{ body: { maxHeight: "calc(100dvh - 240px)", overflowY: "auto", "--line": token.colorBorder, "--secondary": token.colorTextSecondary, "--protection": token.colorSuccess } as CSSProperties }} destroyOnHidden closable={{ "aria-label": "Закрыть справку" }}>
      <Typography.Paragraph>Синтетическое движение · {config.count} объектов за {config.durationMs / 60000} минут</Typography.Paragraph>
      <Typography.Paragraph type="secondary">360° · движение в плане · условная защита на границе зоны</Typography.Paragraph>
      <Typography.Title level={5}>Условная зона защиты</Typography.Title>
      <Typography.Paragraph>Достижение зелёной границы → условное срабатывание. Радиус {protectionRadiusM} м — граница условной зоны защиты, а не дальность средства защиты.</Typography.Paragraph>
      <section className={styles.protectionEvents} aria-label="Журнал условных срабатываний">
        <Typography.Title level={5}>Журнал условных срабатываний</Typography.Title>
        <Typography.Paragraph>{frame.events.length ? `Срабатываний: ${frame.events.length}. Последние ${Math.min(5, frame.events.length)}:` : "Срабатываний пока нет."}</Typography.Paragraph>
        <ol>{frame.events.slice(0, 5).map(event => <li key={event.id} data-protection-event={event.id}>
          <Button style={{ height: "auto", minHeight: 44 }} onClick={() => { setReferenceOpen(false); seek(event.endMs); focusCampus(); }} aria-label={`Показать срабатывание объекта ${event.id + 1}`}>
            <time>{time(event.endMs)}</time><span>Объект {event.id + 1} · {sectorLabels[event.sector]}<small>Условное срабатывание</small></span>
          </Button>
        </li>)}</ol>
      </section>
      <section aria-label="Направления входа">
        <Typography.Title level={5}>Откуда появляются · 360°</Typography.Title>
        <Typography.Paragraph>У каждого объекта свой угол появления в пределах 360°. Восемь секторов по сторонам света только группируют статистику.</Typography.Paragraph>
        <dl className={styles.directionStats}>{sectorLabels.map((label, sector) => <div key={label} data-sector={sector}>
          <dt><i style={{ background: sectorColors[sector] }} aria-hidden />{label}</dt><dd>{summary.sectorCounts[sector]} <small>объектов</small>{aggregate && <small>p90 активных: {aggregate.sectorP90[sector]}</small>}</dd>
        </div>)}</dl>
        <Typography.Paragraph>{aggregate ? "Число объектов — выбранный прогон; p90 — квантиль пиков активности в секторе по пакету." : "Количество за весь выбранный прогон. p90 по секторам появится после расчёта пакета."}</Typography.Paragraph>
      </section>
      {projectScene && <section aria-label="Конфигурация с карты">
        <Typography.Title level={5}>{projectScene.name}</Typography.Title>
        <Typography.Paragraph>Объект и средства используют общее состояние с картой. Для любого объекта пока используется стандартная BIM-модель предприятия. Контур объекта условный. Средства показаны по координатам карты; их эффективность в этом прогоне не рассчитывается.</Typography.Paragraph>
        <ul>{projectScene.placements.map(object => <li key={object.id}>{object.name} · {object.quantity} шт.</li>)}</ul>
      </section>}
      <Typography.Title level={5}>Данные прогона</Typography.Title>
      <Typography.Paragraph type="secondary">Прогон №{runIndex + 1} · seed {run.seed} · {motionVersion} · сессия сбрасывается при выходе или перезагрузке</Typography.Paragraph>
    </Modal>
  </section>;
}
