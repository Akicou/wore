/*
  HTTP transport for AI providers.
  ------------------------------------------------------------------
  Browser `fetch` inside the Tauri webview is subject to CORS. Local
  servers like LM Studio and Ollama do not return permissive CORS
  headers, so direct fetches from the `tauri.localhost` origin fail
  with "Failed to fetch" — even though the server is reachable.

  Route AI requests through @tauri-apps/plugin-http instead: it calls
  reqwest from the Rust host, so there's no preflight, no Origin
  restriction, and no SOP. Falls back to window.fetch when not running
  inside Tauri (e.g. `vite preview` in a browser).
*/

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

let cached: FetchLike | null = null;
let loadPromise: Promise<FetchLike> | null = null;

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function load(): Promise<FetchLike> {
  if (cached) return cached;
  if (!isTauri()) {
    cached = fetch.bind(globalThis);
    return cached;
  }
  if (!loadPromise) {
    loadPromise = import("@tauri-apps/plugin-http")
      .then((mod) => {
        cached = mod.fetch as unknown as FetchLike;
        return cached;
      })
      .catch(() => {
        cached = fetch.bind(globalThis);
        return cached;
      });
  }
  return loadPromise;
}

/** Drop-in fetch that uses Tauri's native HTTP client when available. */
export async function httpFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const f = await load();
  return f(input, init);
}

/**
 * Friendlier error for the LM Studio / Ollama "Failed to fetch" case.
 * The Tauri HTTP plugin throws plain `Error("error sending request: ...")`
 * messages when the server is down, so wrap with hints about what to check.
 */
export function describeNetworkError(err: unknown, baseUrl: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  const local = /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]/i.test(baseUrl);
  const looksLikeNetwork =
    /failed to fetch|networkerror|error sending request|connection (refused|reset)|tcp connect error|os error 10061|deadline|timed out/i.test(
      msg
    );
  if (!looksLikeNetwork) return msg;
  if (local) {
    const port = (baseUrl.match(/:(\d+)/) || [])[1];
    const hint = port === "1234"
      ? "Open LM Studio → Developer tab → 'Start Server' and load a model."
      : port === "11434"
        ? "Start Ollama (`ollama serve`) and pull a model."
        : "Start the local server on " + baseUrl + ".";
    return `Could not reach ${baseUrl}. ${hint}`;
  }
  return `Network error reaching ${baseUrl}: ${msg}`;
}
