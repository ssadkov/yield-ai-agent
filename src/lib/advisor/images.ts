/** Pictures in the private chat: OpenAI-style content parts, encrypted with the rest of the message. */

export type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

/** At most this many pictures per message; each is downscaled in the browser first. */
export const MAX_IMAGES_PER_MESSAGE = 3;
/** Longest side after downscaling, and the size cap for one picture as a data URL. */
export const IMAGE_MAX_SIDE = 1024;
export const IMAGE_MAX_DATA_URL_CHARS = 900_000;

type Message = { role: string; content?: unknown };

/**
 * Only the latest user message keeps its pictures; earlier ones become a text note, so a long chat
 * does not resend every image (request size, cost) on each turn.
 */
export function latestImagesOnly<T extends Message>(messages: T[]): T[] {
  let last = -1;
  messages.forEach((m, i) => {
    if (m.role === "user" && Array.isArray(m.content)) last = i;
  });
  return messages.map((m, i) => {
    if (m.role !== "user" || !Array.isArray(m.content) || i === last) return m;
    const parts = m.content as ContentPart[];
    const text = parts.map((p) => (p.type === "text" ? p.text : "")).join(" ").trim();
    const images = parts.filter((p) => p.type === "image_url").length;
    const note = `[${images} image${images === 1 ? "" : "s"} shared earlier]`;
    return { ...m, content: text ? `${text} ${note}` : note };
  });
}
