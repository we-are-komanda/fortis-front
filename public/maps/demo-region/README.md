# Локальная карта Fortis

Два района по 20×20 км: «Завод Альфа» (37.1° E, 55.1° N) и «Тестовое предприятие» (174.7762° E, 41.2865° S, Веллингтон, Новая Зеландия). Всего 521 уникальный тайл, 20.0 МБ вместе со шрифтами и sprites. Масштабы 0–14, дальнейшее приближение использует данные zoom 14. За пределами bounds детальной подложки нет.

© OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors.

- Данные OSM: https://www.openstreetmap.org/copyright (ODbL).
- OpenMapTiles: https://github.com/openmaptiles/openmaptiles (BSD/CC-BY).
- Стиль Bright: https://github.com/openmaptiles/osm-bright-gl-style (BSD).
- Noto Sans: https://github.com/notofonts/noto-fonts (SIL Open Font License).
- Условия офлайн-загрузки OpenFreeMap: https://openfreemap.org/tos/.

Снимок тайлов указан в manifest.json; файл содержит список районов с bounds, число тайлов и SHA-256 каждого ресурса. Стиль, шрифты и sprites локальные. Исходные style/TileJSON сохранены для происхождения данных, runtime их не загружает.

Восстановление: `python3 scripts/prepare-offline-map.py`. Не более четырёх параллельных запросов, уникальный User-Agent, лимит ниже 50 МБ/3000 тайлов. Повторный запуск использует уже скачанные файлы.
