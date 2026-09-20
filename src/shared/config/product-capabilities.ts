export type CapabilityStatus = "available" | "demo" | "not_released";

export const productCapabilities = {
  workspace: { status: "available", title: "Предприятия и проекты", href: "/workspace", description: "Работа с проектами доступных вам предприятий." },
  map: { status: "available", title: "Конфигурация на карте", href: "/prototype", description: "Разместите объекты и средства защиты на карте." },
  ownData: { status: "available", title: "Собственные исходные данные", description: "Опишите объект и задайте параметры своей конфигурации." },
  versions: { status: "not_released", title: "Сохранение версий", description: "Проверка сохранения версий ещё не завершена." },
  calculation: { status: "available", title: "Расчёт по введённым ценам", href: "/calculator", description: "Стоимость размещённых объектов по указанным ценам с отметками о неполных данных." },
  compare: { status: "not_released", title: "Сравнение вариантов", description: "Проверка сравнения сохранённых вариантов ещё не завершена." },
  report: { status: "not_released", title: "Отчёт для согласования", description: "Проверка состава и выгрузки отчёта ещё не завершена." },
  operational: { status: "demo", title: "Оперативная платформа", href: "/dashboard", description: "Синтетические экраны мониторинга и управления." },
  retrospective: { status: "demo", title: "Ретроспективный анализ", href: "/retrospective-analysis", description: "Демонстрационный модуль вне рабочего релиза." },
  scenarios: { status: "demo", title: "Сценарное моделирование", href: "/prototype?view=scenario-modeling", description: "Демонстрационный модуль вне рабочего релиза." },
} as const satisfies Record<string, { status: CapabilityStatus; title: string; description: string; href?: string }>;

export type ProductCapability = keyof typeof productCapabilities;

// Presentation only. Resource authorization remains the responsibility of the API.
export function canOpenCapability(capability: ProductCapability, mode: "workspace" | "demo" | null) {
  const status: CapabilityStatus = productCapabilities[capability].status;
  return status === "available" || (status === "demo" && mode === "demo");
}

export const calculationLimitation = "Расчёт составляется по введённым данным и не подтверждает фактическую эффективность системы безопасности";
