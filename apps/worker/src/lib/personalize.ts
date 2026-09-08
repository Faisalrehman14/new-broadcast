/** Replace {{first_name}}, {{last_name}}, {{full_name}}, {{name}} in broadcast text. */
export function personalizeBroadcastMessage(
  text: string | null | undefined,
  recipientName: string | null | undefined
): string {
  if (!text || !/\{\{/i.test(text)) return text || '';
  const full = String(recipientName || '').trim() || 'Friend';
  const parts = full.split(/\s+/);
  const first = parts[0] || full;
  const last = parts.length > 1 ? parts.slice(1).join(' ') : '';
  return String(text)
    .replace(/\{\{name\}\}/gi, full)
    .replace(/\{\{full_name\}\}/gi, full)
    .replace(/\{\{first_name\}\}/gi, first)
    .replace(/\{\{last_name\}\}/gi, last || first);
}
