/** 最近阅读时间：今天显示时分，今年显示月/日，更早显示年/月/日 */
export function fmtReadAt(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return ` · 今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.getFullYear() === now.getFullYear()) return ` · ${d.getMonth() + 1}/${d.getDate()}`;
  return ` · ${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
