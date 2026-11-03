import models from "../infra/data/scenario/chemical-models-v1.json";

export const chemicalSiteVersion = "chemical-campus@1";
export type ChemicalKind = "building" | "tank" | "vessel" | "frame" | "basin" | "canopy" | "stack" | "equipment" | "platform";
export type ChemicalObject = {
  id: string; name: string; zone: string; kind: ChemicalKind; purpose: string;
  x: number; y: number; width: number; depth: number; height: number; assetId?: string;
};
export const chemicalZones = [
  ["Z01", "Резервуарный парк"], ["Z02", "Открытые установки"], ["Z03", "Энергоблок и охлаждение"], ["Z04", "Водоподготовка"],
  ["Z05", "Производство А"], ["Z06", "Производство Б"], ["Z07", "Фасовка и упаковка"], ["Z08", "Склады"],
  ["Z09", "Администрация и лаборатория"], ["Z10", "Ремонт и пожарное депо"], ["Z11", "Грузовой двор"], ["Z12", "КПП и парковка"],
].map(([id, name], i) => ({ id, name, x: -420 + (i % 4) * 280, y: 270 - Math.floor(i / 4) * 270 }));

export const chemicalAssets = models.map(model => ({
  ...model, url: `/models/chemical-pilot-v1/${model.id}.glb`,
  width: model.dimensionsM[0], depth: model.dimensionsM[2], height: model.dimensionsM[1],
}));
export const chemicalKinds: Record<ChemicalKind, string> = {
  building: "Здание", tank: "Резервуар", vessel: "Аппарат", frame: "Технологический блок",
  basin: "Бассейн", canopy: "Навес", stack: "Дымовая труба", equipment: "Оборудование", platform: "Платформа",
};
const objects: ChemicalObject[] = [];
function add(zone: string, kind: ChemicalKind, name: string, x: number, y: number, width: number, depth: number, height: number, purpose: string, assetId?: string) {
  const center = chemicalZones.find(z => z.id === zone)!;
  const n = objects.filter(o => o.zone === zone && o.kind === kind).length + 1;
  objects.push({ id: `${zone}-${kind}-${String(n).padStart(2, "0")}`, zone, kind, name, x: center.x + x, y: center.y + y, width, depth, height, purpose, assetId });
}
add("Z01", "building", "Насосная", 70, -65, 24, 12, 6, "Размещение вспомогательного насосного оборудования.");
for (let i = 0; i < 6; i++) add("Z01", "tank", `Резервуар хранения ${i + 1}`, -70 + i % 3 * 32, 65 - Math.floor(i / 3) * 34, 26, 26, 22, "Условное хранение жидких компонентов.");
for (let i = 0; i < 4; i++) add("Z01", "tank", `Буферная ёмкость ${i + 1}`, 40 + i % 2 * 25, 65 - Math.floor(i / 2) * 30, 12, 12, 12, "Условное промежуточное хранение.");
for (let i = 0; i < 4; i++) add("Z01", "vessel", `Горизонтальная ёмкость ${i + 1}`, -70 + i * 22, -25, 10, 3, 4, "Вспомогательная ёмкость на опорах.");
for (let i = 0; i < 2; i++) add("Z02", "frame", `Технологический блок ${i + 1}`, -55 + i * 110, 20, 84, 48, 32, "Открытая установка с аппаратами, тремя уровнями обслуживания и трубными коллекторами.");
for (let i = 0; i < 6; i++) add("Z02", "tank", `Вертикальный аппарат ${i + 1}`, -70 + i * 26, 75, 4, 4, 15, "Условный технологический аппарат.");
add("Z03", "building", "Энергокорпус", -35, 45, 72, 36, 15, "Энергетическое обеспечение площадки.");
add("Z03", "building", "Электротехническое здание", 65, 50, 30, 18, 8, "Размещение электротехнического оборудования.");
for (let i = 0; i < 2; i++) add("Z03", "stack", `Дымовая труба ${i + 1}`, -70 + i * 22, 88, 4, 4, 32, "Внешний элемент энергоблока.");
add("Z04", "building", "Водоподготовка", 45, 60, 48, 24, 9, "Вспомогательная подготовка оборотной воды.");
for (let i = 0; i < 2; i++) {
  add("Z04", "basin", `Круглый бассейн ${i + 1}`, -65 + i * 40, 45, 24, 24, 3, "Условный открытый водный бассейн.");
  add("Z04", "basin", `Прямоугольный бассейн ${i + 1}`, -55 + i * 60, -15, 36, 18, 3, "Условный открытый водный бассейн.");
}
for (let i = 0; i < 2; i++) {
  add("Z05", "building", `Производственный корпус А${i + 1}`, -15, -48 + i * 96, 140, 70, 24, "Синтетический корпус производства промышленных смесей.");
  add("Z06", "building", `Производственный корпус Б${i + 1}`, -25, -43 + i * 86, 110, 60, 22, "Синтетический корпус вспомогательного производства.");
  add("Z08", "building", `Склад ${i + 1}`, -20, -46 + i * 92, 150, 70, 18, "Хранение упаковки и готовой продукции.");
  add("Z07", "canopy", `Навес фасовки ${i + 1}`, -35 + i * 70, -68, 30, 12, 6, "Укрытая погрузочная площадка.");
  add("Z08", "canopy", `Складской навес ${i + 1}`, 83, -46 + i * 92, 18, 36, 7, "Укрытая площадка при складском корпусе.");
  add("Z11", "canopy", `Наливной навес ${i + 1}`, -50 + i * 90, 25, 36, 12, 7, "Условное место обслуживания автоцистерны.");
}
for (let i = 0; i < 6; i++) add("Z06", "tank", `Силос ${i + 1}`, 60 + i % 2 * 18, 55 - Math.floor(i / 2) * 28, 8, 8, 18, "Условное хранение сыпучих компонентов.");
add("Z07", "building", "Фасовка и упаковка", 0, 25, 120, 65, 14, "Участок фасовки готовой продукции.");
add("Z09", "building", "Администрация", -45, 35, 60, 24, 15, "Административные помещения.");
add("Z09", "building", "Лаборатория", 40, 35, 48, 24, 10, "Условная лаборатория контроля качества.");
add("Z10", "building", "Ремонтная мастерская", -45, 35, 60, 36, 12, "Техническое обслуживание оборудования.");
add("Z10", "building", "Пожарное депо", 40, 35, 36, 24, 10, "Учебное размещение службы реагирования.");
add("Z11", "building", "Диспетчерская", 70, -65, 18, 12, 5, "Координация грузового двора.");
add("Z11", "platform", "Весовая платформа", 0, -65, 20, 4, .3, "Условное взвешивание грузового транспорта.");
add("Z12", "building", "КПП", -65, -70, 18, 10, 5, "Контроль въезда на площадку.");
add("Z12", "building", "Проходная", -35, -70, 12, 8, 4, "Вход персонала на площадку.");

function equipment(id: string, name: string, zone: string, positions: number[][], purpose: string) {
  const a = chemicalAssets.find(asset => asset.id === id)!;
  positions.forEach(([x, y], i) => add(zone, "equipment", `${name} ${i + 1}`, x, y, a.width, a.depth, a.height, purpose, id));
}
equipment("M01-pump", "Насосный агрегат", "Z01", Array.from({ length: 6 }, (_, i) => [-70 + i * 15, -65]), "Перекачка жидкости; отдельный экземпляр насосного агрегата.");
equipment("M01-pump", "Насосный агрегат", "Z04", [[-60,-65],[-40,-65],[-20,-65],[0,-65]], "Циркуляция воды в условном контуре.");
equipment("M01-pump", "Насосный агрегат", "Z02", [[-70,-65],[-55,-65]], "Перекачка жидкости в открытой установке.");
equipment("M03-heat-exchanger", "Теплообменник", "Z02", [[-60,-20],[-35,-20],[0,-20],[25,-20]], "Внешняя модель кожухотрубного теплообменника.");
equipment("M04-cooling-tower", "Градирня", "Z03", [[-60,-30],[-35,-30],[0,-30],[25,-30]], "Отвод тепла в условном контуре оборотного водоснабжения.");
equipment("M07-scrubber", "Скруббер", "Z02", [[65,-25],[85,-25]], "Внешняя модель газоочистного аппарата.");
equipment("M07-scrubber", "Скруббер", "Z06", [[70,-55],[90,-55]], "Внешняя модель газоочистного аппарата.");
equipment("M16-tanker-truck", "Автоцистерна", "Z11", [[-50,25],[40,25]], "Учебный транспорт на наливной площадке.");
export const chemicalObjects: readonly ChemicalObject[] = objects;
export function chemicalFocus(id?: string) {
  const object = chemicalObjects.find(o => o.id === id);
  if (object) return { x: object.x, y: object.y, height: object.height, span: Math.max(object.width, object.depth, object.height) * 1.6 };
  const zone = chemicalZones.find(z => z.id === id);
  return zone ? { ...zone, height: 15, span: 320 } : { x: 0, y: 0, height: 0, span: 1450 };
}
