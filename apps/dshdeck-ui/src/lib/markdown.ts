import { marked } from "marked";
import DOMPurify from "dompurify";

export function esc(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

export const mdAvailable = typeof marked?.parse === "function" && typeof DOMPurify?.sanitize === "function";

export function renderMarkdown(text: string): string {
  if (!mdAvailable) return esc(text);
  return DOMPurify.sanitize(marked.parse(text, { breaks: true, gfm: true }) as string);
}
