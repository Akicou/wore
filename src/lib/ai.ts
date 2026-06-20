import { writeError, writeLog } from "./log";

/*
  WoRe AI engine
  ------------------------------------------------------------------
  - Works with any OpenAI- or Anthropic-compatible endpoint.
  - "flavor" decides the wire format: openai | anthropic.
  - Profiles are fully configurable (baseUrl, key, models, defaults).
  - Reasoning/thinking budgets are respected; default maxTokens is large
    (>= 16000) so thinking tokens never truncate the answer.
  - Image generation via OpenRouter / OpenAI-style image endpoints.
*/

export type ProviderFlavor = "openai" | "anthropic";

export interface AIModel {
  id: string;
  label?: string;
  /** supports reasoning/thinking tokens */
  reasoning?: boolean;
  /** supports vision/image input */
  vision?: boolean;
  /** true when vision was verified by sending a tiny image to the model */
  visionTestedAt?: number;
  /** last error from vision probing, if any */
  visionProbeError?: string;
  /** is an image *generation* model */
  imageGen?: boolean;
  contextWindow?: number;
}

export interface AIProfile {
  id: string;
  name: string;
  flavor: ProviderFlavor;
  baseUrl: string;
  apiKey: string;
  /** model used for chat if none chosen */
  defaultChatModel: string;
  /** model used for image generation */
  defaultImageModel: string;
  models: AIModel[];
  /** max output tokens for chat (>= 16000 recommended for reasoning) */
  maxTokens: number;
  /** sampling temperature */
  temperature: number;
  /** send a system preamble describing the document editor context */
  systemContext?: string;
  /** extra headers (JSON object) — e.g. OpenRouter HTTP-Referer */
  extraHeaders?: Record<string, string>;
  createdAt: number;
}

export interface ChatImagePart {
  type: "image";
  /** data:image/... URL preferred; https URLs are supported by OpenAI-compatible providers. */
  dataUrl: string;
  mimeType?: string;
  alt?: string;
}

export type ChatContent = string | Array<{ type: "text"; text: string } | ChatImagePart>;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: ChatContent;
}

export interface ChatOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  /** enable reasoning/thinking if the model supports it */
  reasoning?: boolean;
  /** reasoning effort/thinking budget hint */
  reasoningEffort?: "low" | "medium" | "high";
}

export interface ChatResult {
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

const cleanBase = (u: string) => u.replace(/\/+$/, "");

/* --------------------------------------------------------------------------
   Chat (non-streaming + streaming)
-------------------------------------------------------------------------- */

export async function chat(
  profile: AIProfile,
  messages: ChatMessage[],
  opts: ChatOptions = {}
): Promise<ChatResult> {
  const model = opts.model ?? profile.defaultChatModel;
  const base = opts.maxTokens ?? profile.maxTokens ?? 16384;
  // Only force a large budget when reasoning is on, so thinking tokens never
  // truncate the answer. Otherwise respect the user's configured limit.
  const maxTokens = opts.reasoning ? Math.max(16000, base) : base;

  if (profile.flavor === "anthropic") {
    return anthropicChat(profile, messages, { ...opts, model, maxTokens });
  }
  return openaiChat(profile, messages, { ...opts, model, maxTokens });
}

/** Streaming chat. Yields {delta} for text and {done} at the end. */
export async function* chatStream(
  profile: AIProfile,
  messages: ChatMessage[],
  opts: ChatOptions = {}
): AsyncGenerator<{ delta: string; reasoning?: string; done: boolean }> {
  const model = opts.model ?? profile.defaultChatModel;
  const base = opts.maxTokens ?? profile.maxTokens ?? 16384;
  const maxTokens = opts.reasoning ? Math.max(16000, base) : base;

  if (profile.flavor === "anthropic") {
    yield* anthropicStream(profile, messages, { ...opts, model, maxTokens });
  } else {
    yield* openaiStream(profile, messages, { ...opts, model, maxTokens });
  }
}

/* ----------------------------- OpenAI flavor ----------------------------- */

function openaiHeaders(p: AIProfile): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(p.extraHeaders ?? {}),
  };
  if (p.apiKey && !isLocalPlaceholderKey(p.apiKey)) headers.Authorization = `Bearer ${p.apiKey}`;
  return headers;
}

function textOnly(content: ChatContent): string {
  return typeof content === "string"
    ? content
    : content.filter((p) => p.type === "text").map((p) => p.text).join("\n");
}

function toOpenAiMessages(messages: ChatMessage[]) {
  return messages.map((m) => ({
    role: m.role,
    content:
      typeof m.content === "string"
        ? m.content
        : m.content.map((part) =>
            part.type === "text"
              ? { type: "text", text: part.text }
              : { type: "image_url", image_url: { url: part.dataUrl, detail: "auto" } }
          ),
  }));
}

function dataUrlParts(url: string): { mimeType: string; data: string } | null {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(url);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

function toAnthropicContent(content: ChatContent): string | Array<Record<string, unknown>> {
  if (typeof content === "string") return content;
  const parts: Array<Record<string, unknown>> = [];
  for (const part of content) {
    if (part.type === "text") {
      parts.push({ type: "text", text: part.text });
    } else {
      const parsed = dataUrlParts(part.dataUrl);
      if (!parsed) continue; // Anthropic requires base64 sources, not remote URLs.
      parts.push({
        type: "image",
        source: { type: "base64", media_type: part.mimeType ?? parsed.mimeType, data: parsed.data },
      });
    }
  }
  return parts.length ? parts : "";
}

function toAnthropicMessages(messages: ChatMessage[]) {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role as "user" | "assistant", content: toAnthropicContent(m.content) }));
}

async function openaiChat(
  p: AIProfile,
  messages: ChatMessage[],
  o: Required<Pick<ChatOptions, "model" | "maxTokens">> & ChatOptions
): Promise<ChatResult> {
  const body: Record<string, unknown> = {
    model: o.model,
    messages: toOpenAiMessages(messages),
    max_tokens: o.maxTokens,
    temperature: o.temperature ?? p.temperature ?? 0.6,
    stream: false,
  };
  if (o.reasoning) {
    body.reasoning_effort = o.reasoningEffort ?? "medium";
  }
  const res = await fetch(`${cleanBase(p.baseUrl)}/chat/completions`, {
    method: "POST",
    headers: openaiHeaders(p),
    body: JSON.stringify(body),
    signal: o.signal,
  });
  if (!res.ok) throw await httpError(res);
  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content ?? "";
  return { text, usage: { inputTokens: json?.usage?.prompt_tokens, outputTokens: json?.usage?.completion_tokens } };
}

async function* openaiStream(
  p: AIProfile,
  messages: ChatMessage[],
  o: Required<Pick<ChatOptions, "model" | "maxTokens">> & ChatOptions
) {
  const body: Record<string, unknown> = {
    model: o.model,
    messages: toOpenAiMessages(messages),
    max_tokens: o.maxTokens,
    temperature: o.temperature ?? p.temperature ?? 0.6,
    stream: true,
  };
  if (o.reasoning) body.reasoning_effort = o.reasoningEffort ?? "medium";

  const res = await fetch(`${cleanBase(p.baseUrl)}/chat/completions`, {
    method: "POST",
    headers: { ...openaiHeaders(p), Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal: o.signal,
  });
  if (!res.ok || !res.body) throw await httpError(res);

  let buf = "";
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith("data:")) continue;
      const data = s.slice(5).trim();
      if (data === "[DONE]") {
        yield { delta: "", done: true };
        return;
      }
      try {
        const json = JSON.parse(data);
        const choice = json?.choices?.[0];
        const delta =
          choice?.delta?.content ?? choice?.message?.content ?? "";
        const reasoning = choice?.delta?.reasoning_content ?? "";
        if (delta || reasoning) yield { delta, reasoning, done: false };
      } catch {
        /* keep going on partial json */
      }
    }
  }
  yield { delta: "", done: true };
}

/* --------------------------- Anthropic flavor --------------------------- */

function anthropicHeaders(p: AIProfile): HeadersInit {
  return {
    "Content-Type": "application/json",
    "x-api-key": p.apiKey,
    "anthropic-version": "2023-06-01",
    ...(p.extraHeaders ?? {}),
  };
}

function splitSystem(messages: ChatMessage[]) {
  const sys = messages
    .filter((m) => m.role === "system")
    .map((m) => textOnly(m.content))
    .join("\n\n");
  const rest = toAnthropicMessages(messages);
  return { sys, rest };
}

async function anthropicChat(
  p: AIProfile,
  messages: ChatMessage[],
  o: Required<Pick<ChatOptions, "model" | "maxTokens">> & ChatOptions
): Promise<ChatResult> {
  const { sys, rest } = splitSystem(messages);
  const body: Record<string, unknown> = {
    model: o.model,
    messages: rest,
    max_tokens: o.maxTokens,
    temperature: o.temperature ?? p.temperature ?? 0.6,
  };
  if (sys) body.system = sys;
  if (o.reasoning) {
    body.thinking = {
      type: "enabled",
      budget_tokens: Math.min(o.maxTokens - 1024, Math.floor(o.maxTokens * 0.8)),
    };
    // reasoning requires temperature=1 in Anthropic
    body.temperature = 1;
  }
  const res = await fetch(`${cleanBase(p.baseUrl)}/messages`, {
    method: "POST",
    headers: anthropicHeaders(p),
    body: JSON.stringify(body),
    signal: o.signal,
  });
  if (!res.ok) throw await httpError(res);
  const json = await res.json();
  const text = (json?.content ?? [])
    .filter((c: any) => c.type === "text")
    .map((c: any) => c.text)
    .join("");
  return {
    text,
    usage: { inputTokens: json?.usage?.input_tokens, outputTokens: json?.usage?.output_tokens },
  };
}

async function* anthropicStream(
  p: AIProfile,
  messages: ChatMessage[],
  o: Required<Pick<ChatOptions, "model" | "maxTokens">> & ChatOptions
) {
  const { sys, rest } = splitSystem(messages);
  const body: Record<string, unknown> = {
    model: o.model,
    messages: rest,
    max_tokens: o.maxTokens,
    temperature: o.temperature ?? p.temperature ?? 0.6,
    stream: true,
  };
  if (sys) body.system = sys;
  if (o.reasoning) {
    body.thinking = {
      type: "enabled",
      budget_tokens: Math.min(o.maxTokens - 1024, Math.floor(o.maxTokens * 0.8)),
    };
    body.temperature = 1;
  }
  const res = await fetch(`${cleanBase(p.baseUrl)}/messages`, {
    method: "POST",
    headers: { ...anthropicHeaders(p), Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal: o.signal,
  });
  if (!res.ok || !res.body) throw await httpError(res);

  let buf = "";
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const blocks = buf.split("\n\n");
    buf = blocks.pop() ?? "";
    for (const block of blocks) {
      const line = block.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      try {
        const json = JSON.parse(line.slice(5).trim());
        if (json.type === "content_block_delta") {
          const d = json.delta;
          if (d?.type === "text_delta") yield { delta: d.text ?? "", done: false };
          else if (d?.type === "thinking_delta")
            yield { delta: "", reasoning: d.thinking ?? "", done: false };
        } else if (json.type === "message_stop") {
          yield { delta: "", done: true };
          return;
        }
      } catch {
        /* ignore */
      }
    }
  }
  yield { delta: "", done: true };
}

/* --------------------------------------------------------------------------
   Image generation (OpenRouter / OpenAI-style)
-------------------------------------------------------------------------- */

export interface ImageGenResult {
  /** data URL or remote URL of the generated image */
  url: string;
  /** revised prompt if returned */
  revisedPrompt?: string;
}

export async function generateImage(
  p: AIProfile,
  prompt: string,
  opts: { model?: string; size?: string; n?: number; signal?: AbortSignal } = {}
): Promise<ImageGenResult> {
  const model = opts.model ?? p.defaultImageModel;
  const base = cleanBase(p.baseUrl);

  // 1) Try the OpenAI-style images endpoint (works for OpenAI DALL-E and some OpenRouter models)
  try {
    const res = await fetch(`${base}/images/generations`, {
      method: "POST",
      headers: openaiHeaders(p),
      body: JSON.stringify({
        model,
        prompt,
        n: opts.n ?? 1,
        size: opts.size ?? "1024x1024",
        response_format: "b64_json",
      }),
      signal: opts.signal,
    });
    if (res.ok) {
      const json = await res.json();
      const item = json?.data?.[0];
      if (item?.b64_json)
        return {
          url: `data:image/png;base64,${item.b64_json}`,
          revisedPrompt: item?.revised_prompt,
        };
      if (item?.url) return { url: item.url, revisedPrompt: item?.revised_prompt };
    }
  } catch {
    /* fall through to chat-based generation */
  }

  // 2) Fallback: chat with an image model — many OpenRouter image models return
  //    a markdown image link or a URL in the assistant message.
  const { text } = await chat(
    p,
    [
      {
        role: "system",
        content:
          "You are an image generation model. Respond ONLY with a single markdown image: ![image](URL). No prose.",
      },
      { role: "user", content: prompt },
    ],
    { model, maxTokens: 1024, signal: opts.signal, temperature: 0.8 }
  );
  const match = text.match(/!\[[^\]]*\]\(([^)]+)\)/);
  if (match) return { url: match[1] };
  throw new Error(
    `Image generation did not return an image. Model response: ${text.slice(0, 160)}`
  );
}

/* --------------------------------------------------------------------------
   Model discovery
-------------------------------------------------------------------------- */

function tinyVisionProbePng(): string {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = "#00ff00";
    ctx.fillRect(16, 0, 16, 16);
    ctx.fillStyle = "#0000ff";
    ctx.fillRect(0, 16, 16, 16);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(16, 16, 16, 16);
  }
  return canvas.toDataURL("image/png");
}

/** Probe a model by sending a tiny 32×32 image. No error => vision-capable. */
export async function probeModelVision(
  p: AIProfile,
  model: string
): Promise<{ vision: boolean; message: string }> {
  const ac = new AbortController();
  const timeout = window.setTimeout(() => ac.abort(), 12000);
  await writeLog("info", "vision", "Vision probe started", {
    profile: p.name,
    baseUrl: cleanBase(p.baseUrl),
    model,
  });
  try {
    const res = await chat(
      p,
      [
        {
          role: "user",
          content: [
            { type: "text", text: "This is a tiny 32×32 probe image. Reply with exactly: ok" },
            { type: "image", dataUrl: tinyVisionProbePng(), mimeType: "image/png", alt: "32x32 vision probe image" },
          ],
        },
      ],
      { model, maxTokens: 16, temperature: 0, signal: ac.signal, reasoning: false }
    );
    await writeLog("info", "vision", "Vision probe succeeded", {
      profile: p.name,
      model,
      response: res.text.slice(0, 80),
    });
    return { vision: true, message: res.text.trim() || "Model accepted image input." };
  } catch (e) {
    const message = (e as Error).name === "AbortError" ? "Vision probe timed out." : (e as Error).message;
    await writeError("vision", "Vision probe failed", e, { profile: p.name, model });
    return { vision: false, message };
  } finally {
    window.clearTimeout(timeout);
  }
}

/** Detect available models from the endpoint's /models list. */
export async function detectModels(p: AIProfile): Promise<AIModel[]> {
  const base = cleanBase(p.baseUrl);
  await writeLog("info", "models", "Detect models started", {
    profile: p.name,
    baseUrl: base,
    flavor: p.flavor,
    hasApiKey: !!p.apiKey,
  });
  try {
    const models = p.flavor === "anthropic"
      ? await detectAnthropicModels(p)
      : base.includes("openrouter.ai")
        ? await detectOpenRouterModels(p)
        : await detectOpenAiModels(p);
    await writeLog("info", "models", "Detect models succeeded", {
      profile: p.name,
      baseUrl: base,
      count: models.length,
      sample: models.slice(0, 8).map((m) => m.id),
    });
    return models;
  } catch (e) {
    await writeError("models", "Detect models failed", e, {
      profile: p.name,
      baseUrl: base,
      flavor: p.flavor,
      isLocal: isLocalEndpoint(base),
    });
    throw e;
  }
}

async function detectOpenAiModels(p: AIProfile): Promise<AIModel[]> {
  const base = cleanBase(p.baseUrl);
  const ac = new AbortController();
  const timeout = window.setTimeout(() => ac.abort(), isLocalEndpoint(base) ? 5000 : 15000);
  try {
    const headers: Record<string, string> = {};
    // LM Studio / Ollama OpenAI-compatible endpoints do not need auth and some
    // local servers dislike an empty `Authorization: Bearer ` header.
    if (p.apiKey && !isLocalPlaceholderKey(p.apiKey)) headers.Authorization = `Bearer ${p.apiKey}`;

    await writeLog("debug", "models", "GET /models", { base, headers: Object.keys(headers) });
    const res = await fetch(`${base}/models`, { headers, signal: ac.signal });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Could not list models (${res.status}): ${detail.slice(0, 200)}`);
    }
    const json = await res.json().catch(() => null);
    const data: Array<Record<string, any>> = Array.isArray(json) ? json : json?.data ?? [];
    const models = data
      .map((m) => (typeof m?.id === "string" ? m.id : typeof m?.name === "string" ? m.name : ""))
      .filter(Boolean)
      .map((id) => modelTagFromId(id));
    if (!models.length) {
      throw new Error(
        isLocalEndpoint(base)
          ? "No models returned. Make sure LM Studio/Ollama server is running and a model is loaded."
          : "No models returned by endpoint."
      );
    }
    return models;
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      throw new Error(`Timed out listing models from ${base}. Is the local server running?`);
    }
    throw e;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function detectAnthropicModels(p: AIProfile): Promise<AIModel[]> {
  const base = cleanBase(p.baseUrl);
  const ac = new AbortController();
  const timeout = window.setTimeout(() => ac.abort(), 15000);
  try {
    // Anthropic requires x-api-key + anthropic-version, NOT Bearer auth.
    const res = await fetch(`${base}/models`, { headers: anthropicHeaders(p), signal: ac.signal });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Could not list Anthropic models (${res.status}): ${detail.slice(0, 200)}`);
    }
    const json = await res.json().catch(() => null);
    const data: Array<Record<string, any>> = Array.isArray(json) ? json : json?.data ?? [];
    const models = data
      .map((m) => (typeof m?.id === "string" ? m.id : ""))
      .filter(Boolean)
      .map((id) => modelTagFromId(id));
    if (!models.length) throw new Error("No models returned by Anthropic.");
    return models;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error(`Timed out listing Anthropic models from ${base}.`);
    throw e;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function detectOpenRouterModels(p: AIProfile): Promise<AIModel[]> {
  const headers: Record<string, string> = {};
  if (p.apiKey) headers.Authorization = `Bearer ${p.apiKey}`;
  await writeLog("debug", "models", "GET OpenRouter /models", { baseUrl: cleanBase(p.baseUrl), hasApiKey: !!p.apiKey });
  const res = await fetch(`${cleanBase(p.baseUrl)}/models`, { headers });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Could not list OpenRouter models (${res.status}): ${detail.slice(0, 200)}`);
  }
  const json = await res.json();
  const data: Array<Record<string, any>> = json.data ?? [];
  return data.map((m) => {
    const id = String(m.id ?? "");
    const label = String(m.name ?? m.id ?? "");
    const arch = m.architecture ?? {};
    const modality = (m.description ?? "").toLowerCase();
    const isImage =
      /image generation|imagen|dall|stable.diffusion|flux|midjourney|ideogram|recraft/.test(
        `${modality} ${id} ${label}`.toLowerCase()
      );
    const isReasoning =
      /reasoning|thinking|o1|o3|o4|r1|deepseek.*/i.test(`${id} ${label} ${arch.instruct_type ?? ""}`);
    const isVision = /vision|gpt-4o|claude.*sonnet|gemini|qwen.*vl|llava|moondream|minicpm.*v|pixtral|gemma.*vision/i.test(`${id} ${label}`);
    return {
      id,
      label,
      reasoning: isReasoning,
      vision: isVision,
      imageGen: isImage,
      contextWindow: typeof m.context_length === "number" ? m.context_length : undefined,
    };
  });
}

function isLocalEndpoint(baseUrl: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(baseUrl);
}

/**
 * True when the given model actually supports reasoning/thinking. Prefer the
 * explicit per-model flag (set by detection); otherwise fall back to id
 * heuristics. Defaults to OFF so we never send reasoning params to models that
 * reject them (e.g. gpt-4o, claude-3.5) which would 400 the whole request.
 */
export function modelReasoningCapable(
  profile: Pick<AIProfile, "models">,
  modelId: string
): boolean {
  const model = profile.models?.find((m) => m.id === modelId);
  if (model && typeof model.reasoning === "boolean") return model.reasoning;
  const lower = (modelId || "").toLowerCase();
  return (
    /\bo[134]\b|o\d+-mini|-r1\b|\br1-|reasoner|reasoning|thinking/i.test(lower) ||
    /claude-?(3-7|3\.7|opus-4|sonnet-4|haiku-4|opus-?4|sonnet-?4)/i.test(lower)
  );
}

function isLocalPlaceholderKey(key: string): boolean {
  return ["ollama", "lm-studio", "lmstudio", "none", "local"].includes(key.trim().toLowerCase());
}

export function modelTagFromId(id: string): AIModel {
  const lower = id.toLowerCase();
  const isImage = /dall|imagen|stable-diffusion|flux|midjourney|ideogram|recraft/.test(lower);
  const isReasoning = /\bo1\b|\bo3\b|\bo4\b|\bo\d+-|r1|deepseek.*reasoner|reasoning|thinking/i.test(lower);
  const isVision = /vision|gpt-4o|claude.*sonnet|gemini|qwen.*vl|llava|moondream|minicpm.*v|pixtral|gemma.*vision/.test(lower);
  const context = /128k/.test(lower) ? 128000 : /200k/.test(lower) ? 200000 : undefined;
  return {
    id,
    label: id.split("/").pop() ?? id,
    reasoning: isReasoning,
    vision: isVision,
    imageGen: isImage,
    contextWindow: context,
  };
}

/* --------------------------------------------------------------------------
   API-key discovery (Tauri desktop env vars)
-------------------------------------------------------------------------- */

export interface EnvKeyResult {
  profileName: string;
  key: string;
  source: string;
}

/** Ask the Tauri host for known API keys. Falls back to empty on web. */
export async function scanEnvKeys(): Promise<EnvKeyResult[]> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return (await invoke<EnvKeyResult[]>("scan_env_keys")) ?? [];
  } catch {
    return [];
  }
}

/* --------------------------------------------------------------------------
   Helpers
-------------------------------------------------------------------------- */

async function httpError(res: Response): Promise<Error> {
  let detail = "";
  try {
    const t = await res.text();
    detail = t.slice(0, 400);
  } catch {
    /* ignore */
  }
  return new Error(
    `AI request failed (${res.status} ${res.statusText})${detail ? `: ${detail}` : ""}`
  );
}

/** Quick connectivity probe for a profile. */
export async function pingProfile(p: AIProfile): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await chat(
      p,
      [
        { role: "system", content: "Reply with the single word: pong" },
        { role: "user", content: "ping" },
      ],
      { maxTokens: 16, temperature: 0 }
    );
    return { ok: !!res.text.trim(), message: res.text.trim() || "ok" };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** Sensible default profile presets. */
export const PROFILE_PRESETS: (Omit<AIProfile, "id" | "createdAt" | "apiKey"> & { apiKey?: string })[] = [
  {
    name: "OpenAI",
    flavor: "openai",
    baseUrl: "https://api.openai.com/v1",
    defaultChatModel: "gpt-4o-mini",
    defaultImageModel: "dall-e-3",
    maxTokens: 16384,
    temperature: 0.6,
    models: [
      { id: "gpt-4o", label: "GPT-4o", vision: true, contextWindow: 128000 },
      { id: "gpt-4o-mini", label: "GPT-4o mini", vision: true, contextWindow: 128000 },
      { id: "o4-mini", label: "o4-mini", reasoning: true, vision: true, contextWindow: 200000 },
      { id: "dall-e-3", label: "DALL·E 3 (image)", imageGen: true },
    ],
  },
  {
    name: "Anthropic",
    flavor: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    defaultChatModel: "claude-3-5-sonnet-latest",
    defaultImageModel: "claude-3-5-sonnet-latest",
    maxTokens: 16000,
    temperature: 0.6,
    models: [
      { id: "claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet", vision: true, reasoning: true, contextWindow: 200000 },
      { id: "claude-3-5-haiku-latest", label: "Claude 3.5 Haiku", vision: true, contextWindow: 200000 },
      { id: "claude-opus-4-1", label: "Claude Opus 4.1", vision: true, reasoning: true, contextWindow: 200000 },
    ],
  },
  {
    name: "OpenRouter",
    flavor: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultChatModel: "openai/gpt-4o-mini",
    defaultImageModel: "openai/dall-e-3",
    maxTokens: 16384,
    temperature: 0.6,
    extraHeaders: {
      "HTTP-Referer": "https://nayhein.com",
      "X-Title": "WoRe by Nayhein.com",
    },
    models: [
      { id: "openai/gpt-4o-mini", label: "GPT-4o mini", vision: true },
      { id: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet", vision: true, reasoning: true },
      { id: "google/gemini-flash-1.5", label: "Gemini Flash 1.5", vision: true },
      { id: "deepseek/deepseek-r1", label: "DeepSeek R1", reasoning: true },
      { id: "openai/dall-e-3", label: "DALL·E 3 (image)", imageGen: true },
      { id: "google/imagen-3", label: "Imagen 3 (image)", imageGen: true },
    ],
  },
  {
    name: "Local (Ollama)",
    flavor: "openai",
    baseUrl: "http://localhost:11434/v1",
    defaultChatModel: "llama3.1",
    defaultImageModel: "llama3.1",
    maxTokens: 16384,
    temperature: 0.6,
    apiKey: "ollama",
    models: [],
  },
  {
    name: "LM Studio",
    flavor: "openai",
    baseUrl: "http://localhost:1234/v1",
    defaultChatModel: "",
    defaultImageModel: "",
    maxTokens: 16384,
    temperature: 0.6,
    apiKey: "",
    models: [],
  },
];
