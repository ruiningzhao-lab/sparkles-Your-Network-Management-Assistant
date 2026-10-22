// Calendar descriptions arrive as Outlook HTML, conferencing boilerplate and pasted
// signatures. Clean them once, when they are synced, and store only the result.

const MAX = 2000;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

function decode(s: string) {
  return s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d*);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (ENTITIES[k]) return ENTITIES[k];
    if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
    if (k.startsWith('#')) return String.fromCodePoint(parseInt(k.slice(1), 10));
    return m;
  });
}

const JOIN = /https?:\/\/(?:[\w-]+\.)*(?:zoom\.us|zoomgov\.com|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|webex\.com)\/[^\s<>"')\]]+/i;

// Conferencing blocks sit at the end of a description; everything from their header on is dropped.
const HEADER = /^(microsoft teams meeting|join zoom meeting|join with google meet|(cisco )?webex meeting|zoom meeting invitation|join microsoft teams meeting)\b/i;
// Vendor help and download links that come with those blocks.
const JUNK_LINK = /aka\.ms\/|microsoft\.com\/[^\s]*teams|support\.google\.com|tel\.meet\/|zoom\.us\/(download|u\/)|webex\.com\/(downloads|help)/i;

// A line that belongs to a conferencing block or a dial-in section.
const BOILER = [
  /join (zoom|the|microsoft teams|with google meet|webex)/i,
  /^(meeting|webinar) id\b/i,
  /^(passcode|password|pin)\b/i,
  /^one tap mobile/i,
  /^dial[- ]?in|^dial by your location|^find your local number/i,
  /^\+?[\d\s().-]{8,}(,,[\d#*]+)?\s*(\w[\w\s()]*)?$/,
  /^meeting link:/i,
  /do not (edit|delete) this section/i,
  /^-{2,}\s*$|^_{4,}\s*$|^[─━=~*]{4,}\s*$/,
  /^(more phone numbers|learn more about meet|learn more|help|meeting options|need help\?)/i,
  /^join by (phone|video|sip|skype|h\.323)/i,
  /^(click here to join|for organizers:|or call in)/i,
  /\.zoom\.us\/|meet\.google\.com|teams\.microsoft\.com|webex\.com/i,
];

// Where a signature or legal footer starts. Everything after it is dropped.
const FOOTER = [/^--\s*$/, /^(sent from my|get outlook for)/i, /^(this (e-?mail|message)( and any attachments)? (is|are|may be) (confidential|intended))/i, /^(confidentiality notice|disclaimer):?/i];

export type Cleaned = { text: string; links: string[]; joinUrl?: string };

export function cleanDescription(raw: string | null | undefined): Cleaned {
  if (!raw) return { text: '', links: [] };
  let s = String(raw);
  const joinUrl = s.match(JOIN)?.[0]?.replace(/[.,;]+$/, '');
  // Linked text keeps its label; the targets become link chips.
  const hrefs: string[] = [];
  s = s.replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
    if (/^https?:/i.test(href)) hrefs.push(href);
    return label.replace(/<[^>]+>/g, '').trim() || href;
  });
  s = s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/(p|div|li|ul|ol|h\d|tr|table|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  s = decode(s).replace(/\r/g, '').replace(/[ \t\u00a0]+/g, ' ');

  const out: string[] = [];
  for (let line of s.split('\n')) {
    line = line.trim();
    if (HEADER.test(line) || FOOTER.some((r) => r.test(line))) break;
    if (line && BOILER.some((r) => r.test(line))) continue;
    if (!line && (!out.length || out[out.length - 1] === '')) continue;
    out.push(line);
  }
  while (out.length && !out[out.length - 1]) out.pop();
  let text = out.join('\n');

  const links = [...new Set([...hrefs, ...(text.match(/https?:\/\/[^\s<>"')\]]+/g) || [])].map((u) => u.replace(/[.,;]+$/, '')))].filter((u) => !JOIN.test(u) && !JUNK_LINK.test(u)).slice(0, 8);
  if (!/[a-z]{3}/i.test(text.replace(/https?:\/\/\S+/g, ''))) text = '';
  if (text.length > MAX) text = text.slice(0, MAX - 1).replace(/\s+\S*$/, '') + '…';
  return { text, links, joinUrl };
}

/** "https://docs.google.com/document/d/…" -> "docs.google.com" */
export function domainOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
