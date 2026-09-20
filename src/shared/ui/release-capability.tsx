import Link from "next/link";
import { productCapabilities, type ProductCapability } from "@/shared/config/product-capabilities";

export function CapabilityNotice({ capability }: { capability: ProductCapability }) {
  return <section className="mx-auto max-w-2xl px-6 py-12 text-slate-700">
    <h1 className="text-2xl font-semibold text-slate-950">{productCapabilities[capability].title}</h1>
    <p role="status" className="mt-4 leading-relaxed">Раздел не включён в текущий рабочий релиз.</p>
    <p className="mt-2 leading-relaxed">Для работы с предприятиями и проектами перейдите в рабочую зону.</p>
    <Link href="/workspace" className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-blue-600 px-4 font-semibold text-white">Войти в рабочую зону</Link>
  </section>;
}
