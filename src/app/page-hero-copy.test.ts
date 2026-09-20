import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import LandingPage from "./page";

test("release landing renders the approved positioning and honest workflow links", () => {
  const html = renderToStaticMarkup(createElement(LandingPage));
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  for (const copy of [
    "Планирование конфигураций и бюджета безопасности объекта",
    "Соберите конфигурацию на карте, сравните сохранённые варианты и подготовьте отчёт для согласования",
    "Войти в рабочую зону",
    "Запросить демонстрацию",
    "Расчёт составляется по введённым данным и не подтверждает фактическую эффективность системы безопасности",
  ]) assert.ok(text.includes(copy), `Missing approved copy: ${copy}`);
  assert.match(html, /href="\/workspace"/);
  assert.match(text, /Проверяем доступность формы/);
  assert.doesNotMatch(html, /name="email"/);
  assert.doesNotMatch(html, /href="\/dashboard/);
  assert.doesNotMatch(text, /99\.9|98\.7|−40%|2\.3×|24 час|24 ч|SLA|uptime|слепых зон|Самообновляющаяся|умнеет с каждым|Droneshield|Hikvision|Заявка принята|уже доступно/i);
});
