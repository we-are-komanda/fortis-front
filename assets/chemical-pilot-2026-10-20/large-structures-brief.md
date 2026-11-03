# Крупные сооружения химического предприятия — новая первая очередь

## Масштаб и приоритет

Основной масштаб просмотра — предприятие и отдельный цех. Главные модели должны занимать десятки и сотни метров, формировать силуэт и характер площадки. Насосы, теплообменники, одиночные вентиляторные ячейки и транспорт уже получены, но относятся к вспомогательному наполнению. Их дальнейшая детализация отложена.

Площадка: 1200 × 900 м. Координатная единица — метр. Размеры ниже являются заданием для вымышленной учебной сцены, а не инженерными параметрами реального объекта.

| ID / имя картинки | Объект целиком | Целевые Д × Ш × В | Что должно читаться с общего вида |
| --- | --- | --- | --- |
| G01-production-hall.png | Крупный производственный корпус | 140 × 70 × 24 м | Четыре продольных пролёта кровли, протяжённые фасады, световые фонари, крупные вентиляционные объёмы, погрузочные ворота |
| G02-process-unit.png | Открытый технологический блок | 84 × 48 × 32 м | Стальной каркас в три уровня, несколько высоких аппаратов, крупные трубные коллекторы, галереи и лестничные башни |
| G03-tank-farm.png | Группа крупных резервуаров | 120 × 90 × 24 м | Шесть резервуаров Ø26 × 22 м в двух рядах, общий обвалованный контур, проходы и магистральный трубный коллектор |
| G04-energy-cooling-block.png | Энергетический блок с охлаждением | 100 × 65 × 40 м | Энергокорпус, две высокие трубы, многосекционный блок охлаждения и крупная трубная эстакада |
| G05-warehouse-loading.png | Складской корпус с погрузочным фронтом | 150 × 70 × 18 м | Большой многопролётный склад, ритм доковых ворот, погрузочные навесы и пандусы |

G01 повторяется для основных производственных корпусов. G02 — для двух открытых установок. G03 заменяет макет группы резервуаров, G04 — соответствующие объёмы энергозоны, G05 — складские корпуса. Крупный составной ассет **заменяет** занимаемую им группу макета, а не накладывается поверх неё. Карточка в первой итерации относится к сооружению или блоку целиком.

## Общие требования к пяти картинкам

- Одна картинка — одно сооружение или один перечисленный составной блок целиком.
- Архитектурный вид в три четверти сверху, угол возвышения камеры 25–35°. Видны длинный и торцевой фасады и кровля.
- Полный силуэт с запасом 5–10% по краям. Нейтральный однотонный фон; без соседних зданий, людей, автомобилей, подписей, размерных стрелок и декоративной подставки.
- Современное эксплуатируемое предприятие: светло-серая обшивка, серо-синие кровли и крупные конструкции, оцинкованная сталь, жёлтые ограждения. Умеренные следы эксплуатации.
- Прямые вертикали, единый шаг конструкций, физически связные крупные объёмы. Двери и ворота служат масштабными признаками; не увеличивать мелкие агрегаты для выразительности.
- Большой корпус не заменять одним гладким параллелепипедом. Не уходить в болты, приборы, отдельные насосы и прочий мелкий декор.
- Для референса достаточно изображения с длинной стороной 2048 px. Дополнительные ракурсы — только согласованные виды того же сооружения.

## Промпты для сервиса генерации изображений

К каждому промпту добавить общий блок ниже.

### G01 — производственный корпус

> An entire large chemical manufacturing hall, approximately 140 metres long, 70 metres wide and 24 metres high. Four parallel long-span industrial roof bays, coherent roof ridges, long bands of rooflights, several large rooftop ventilation housings, articulated industrial panel facades with a consistent structural bay rhythm, clerestory windows, realistically sized loading doors and a lower attached service strip contained within the building footprint. The architecture and roofscape are the subject. Readable building-scale construction, not a plain featureless box, not a miniature shed. Show the complete building from an elevated three-quarter architectural view.

### G02 — технологический блок

> One complete outdoor chemical process unit, approximately 84 metres by 48 metres and 32 metres tall. A substantial three-level steel structure with several large vertical process vessels rising through and above the platforms, broad maintenance galleries, two coherent stair towers, large pipe headers and a clearly organized pipe rack. Dense but legible industrial massing, physically connected equipment and supports, strong differences in height and volume. This is a whole plant process block, not one small pump or isolated vessel. Show its complete footprint and highest structures from an elevated three-quarter architectural view.

### G03 — резервуарный парк

> One complete large industrial tank storage group occupying approximately 120 by 90 metres. Six cylindrical vertical storage tanks arranged in two rows of three, each approximately 26 metres in diameter and 22 metres high, shallow conical roofs, coherent circumferential access platforms, a shared low containment wall, service passages and one organized main pipe manifold. Preserve consistent tank dimensions and clear spaces between tanks. Emphasize the large repeating volumes and recognizable tank-farm silhouette. No individual small skid as the main subject. Show the entire group from an elevated three-quarter architectural view.

### G04 — энергоблок и охлаждение

> One complete chemical plant utility block occupying approximately 100 by 65 metres, maximum height 40 metres. A substantial industrial energy building, two tall cylindrical exhaust stacks, one adjacent long multi-cell cooling structure with a coherent row of large top fan housings, and a major pipe bridge physically connecting the cooling block to the energy building. Clear hierarchy between building, stacks, cooling cells and pipe rack. A full-scale utility complex with several connected large volumes, not a single small cooling tower or standalone fan. Show the whole complex from an elevated three-quarter architectural view.

### G05 — склад и погрузочный фронт

> An entire large industrial warehouse and loading building, approximately 150 metres long, 70 metres wide and 18 metres high. Broad multi-bay roof, long rooflight strips, a consistent structural rhythm, a clearly readable row of loading dock doors along one long facade, substantial loading canopies, dock platforms and gently sloped vehicle ramps. Architectural panel joints and major service volumes, restrained industrial detailing. Make the long loading frontage and large roof volume visually distinct from a production hall. No trucks, forklifts or pallets as the central subject. Show the complete building from an elevated three-quarter architectural view.

### Общий блок к каждому промпту

> Realistic architectural visualization for a fictional contemporary chemical enterprise. Building-scale asset, clean readable silhouette, straight structural lines, coherent supports and physically plausible proportions. Light grey cladding, muted blue-grey roofing, galvanized steel and restrained yellow safety rails. Soft neutral daylight, balanced material contrast, no dramatic glow, no excessive rust. Entire asset visible, elevated three-quarter view with a 25–35 degree camera elevation, neutral plain background, no surrounding city or terrain, no decorative plinth, no people, no vehicles, no labels, no logos, no dimensions, no collage, no cutaway interiors, no close-up equipment view.

## Проверка до Meshy

1. Разместить референс и размерный макет рядом. Сопоставить общую пропорцию, число пролётов/аппаратов и крупные конструктивные связи.
2. Проверить читаемость сооружения при обзоре всей площадки и при приближении к зоне 200–300 м. Приёмка не строится на осмотре метрового насоса.
3. Начать с G01 или G02 как контрольного крупного объекта. Сначала проверить его результат в сцене, затем запускать остальные сооружения.
4. Повторные генерации и новую партию запускать только в пределах отдельно подтверждённого бюджета. Первоначальные 150 кредитов потрачены на M01/M03/M04/M07/M16; это не остаток бюджета.

В Meshy передаётся подготовленная картинка. Текст выше предназначен для сервиса создания референсов; нельзя обещать, что Image to 3D дополнительно исполнит этот текст как геометрический промпт.

## Текущий статус

Новые детальные модели G01–G05 ещё не сгенерированы. В Fortis подготовлен размерный макет основных корпусов с многопролётной кровлей, фасадами и технологических блоков с крупными аппаратами. Это средство проверки масштаба и композиции, а не готовая подробная BIM-модель. Пять ранее полученных малых моделей сохранены во вспомогательном слое и по умолчанию не загружаются.
