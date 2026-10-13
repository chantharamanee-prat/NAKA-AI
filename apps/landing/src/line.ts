const LINE_API = "https://api.line.me/v2/bot";
const MAX_TEXT = 5000; // LINE limit per text message

/** Verify the x-line-signature header (HMAC-SHA256 of the raw body, base64). */
export async function verifySignature(body: string | Uint8Array, signature: string | null, secret: string): Promise<boolean> {
  if (!signature) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const data = typeof body === "string" ? enc.encode(body) : body;
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, data as BufferSource));
  const expected = btoa(String.fromCharCode(...mac));
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

function toMessages(text: string) {
  const chunks: string[] = [];
  for (let i = 0; i < text.length && chunks.length < 5; i += MAX_TEXT) chunks.push(text.slice(i, i + MAX_TEXT));
  return chunks.map((t) => ({ type: "text", text: t }));
}

async function call(token: string, path: string, payload: unknown): Promise<Response> {
  return fetch(`${LINE_API}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
}

/** Reply with the reply token; fall back to a push message if the token has expired. */
export async function replyOrPush(token: string, replyToken: string, userId: string, text: string): Promise<void> {
  const messages = toMessages(text);
  const res = await call(token, "/message/reply", { replyToken, messages });
  if (res.ok) return;
  // Log only the status code: LINE error bodies can echo message content the customer sent.
  console.warn("LINE reply failed, falling back to push", res.status);
  const push = await call(token, "/message/push", { to: userId, messages });
  if (!push.ok) console.error("LINE push failed", push.status);
}

/** Push a message outside the reply window (used by admins in human mode). */
export async function pushText(token: string, userId: string, text: string): Promise<boolean> {
  const res = await call(token, "/message/push", { to: userId, messages: toMessages(text) });
  if (!res.ok) console.error("LINE push failed", res.status);
  return res.ok;
}

/** Show the "typing…" animation while the agent works (1:1 chats only). */
export async function startLoading(token: string, userId: string): Promise<void> {
  await call(token, "/chat/loading/start", { chatId: userId, loadingSeconds: 30 }).catch(() => undefined);
}

export async function getDisplayName(token: string, userId: string): Promise<string> {
  const res = await fetch(`${LINE_API}/profile/${userId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return "";
  const profile = (await res.json()) as { displayName?: string };
  return profile.displayName ?? "";
}

/** The bot's own identity for a channel access token (Stage 1 connect: ownership proof). */
export async function getBotInfo(token: string): Promise<{ userId: string; basicId: string; displayName: string } | null> {
  const res = await fetch(`${LINE_API}/info`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  try {
    const info = (await res.json()) as { userId?: unknown; basicId?: unknown; displayName?: unknown };
    if (typeof info.userId !== "string" || !info.userId || typeof info.basicId !== "string" || !info.basicId) return null;
    return { userId: info.userId, basicId: info.basicId, displayName: typeof info.displayName === "string" ? info.displayName : "" };
  } catch {
    return null;
  }
}

/**
 * The channel id a channel access token was issued for (Stage 1 connect: C1).
 * `/v2/bot/info` carries no channel id, so the token alone cannot prove which OA it belongs to;
 * the OAuth verify endpoint answers with the token's `client_id`, which is the channel id (digits).
 * Returns null when the token is invalid — the connect is then rejected, never stored.
 */
export async function verifyChannelToken(token: string): Promise<{ channelId: string } | null> {
  let res: Response;
  try {
    res = await fetch(`https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(token)}`);
  } catch {
    return null;
  }
  if (!res.ok) return null;
  try {
    const info = (await res.json()) as { client_id?: unknown };
    if (typeof info.client_id !== "string" || !/^\d{4,20}$/.test(info.client_id)) return null;
    return { channelId: info.client_id };
  } catch {
    return null;
  }
}
