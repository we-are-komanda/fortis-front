export function safeNextPath(value: string | null | undefined) {
 if (!value?.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) return "/workspace";
 try {
  const url = new URL(value, "https://fortis.invalid");
  return url.origin === "https://fortis.invalid" ? `${url.pathname}${url.search}${url.hash}` : "/workspace";
 } catch { return "/workspace"; }
}
