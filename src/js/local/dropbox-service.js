const DROPBOX_TOKEN_KEY = "spool.dropbox.tokens";
const DROPBOX_VERIFIER_KEY = "spool.dropbox.verifier";
const AUDIO_PATTERN = /\.(?:mp3|m4a|flac|ogg|wav|aac|opus)$/iu;
const LYRICS_PATTERN = /\.(?:lrc|txt)$/iu;

export class DropboxImportService {
  constructor({ appKey = "6e0uufvam3vwl67", storage = globalThis.localStorage, session = globalThis.sessionStorage, fetchImpl = globalThis.fetch } = {}) {
    this.appKey = appKey;
    this.storage = storage;
    this.session = session;
    this.fetch = fetchImpl;
    this.tokens = readJson(storage?.getItem(DROPBOX_TOKEN_KEY));
  }

  get connected() {
    return Boolean(this.tokens?.refreshToken);
  }

  async beginConnect() {
    if (!this.appKey) throw new Error("A Dropbox app key is required.");
    const verifier = randomVerifier();
    const challenge = base64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    this.session?.setItem(DROPBOX_VERIFIER_KEY, verifier);
    const url = new URL("https://www.dropbox.com/oauth2/authorize");
    url.search = new URLSearchParams({
      client_id: this.appKey,
      response_type: "code",
      token_access_type: "offline",
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    window.open(url.href, "_blank", "noopener,noreferrer");
  }

  async finishConnect(code) {
    const verifier = this.session?.getItem(DROPBOX_VERIFIER_KEY);
    if (!verifier) throw new Error("Start the Dropbox connection first.");
    const response = await this.fetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: String(code || "").trim(),
        grant_type: "authorization_code",
        client_id: this.appKey,
        code_verifier: verifier,
      }),
    });
    if (!response.ok) throw new Error("Dropbox authorization failed. Check the pasted code.");
    const payload = await response.json();
    this.tokens = {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresAt: Date.now() + Math.max(60, Number(payload.expires_in) - 60) * 1000,
    };
    this.storage?.setItem(DROPBOX_TOKEN_KEY, JSON.stringify(this.tokens));
    this.session?.removeItem(DROPBOX_VERIFIER_KEY);
    return true;
  }

  disconnect() {
    this.tokens = null;
    this.storage?.removeItem(DROPBOX_TOKEN_KEY);
    this.session?.removeItem(DROPBOX_VERIFIER_KEY);
  }

  async list(path = "", { mode = "audio" } = {}) {
    const token = await this.#accessToken();
    const response = await this.fetch("https://api.dropboxapi.com/2/files/list_folder", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ path, recursive: false, limit: 2000 }),
    });
    if (!response.ok) throw new Error("Dropbox could not list that folder.");
    const payload = await response.json();
    const pattern = mode === "lyrics" ? LYRICS_PATTERN : AUDIO_PATTERN;
    return (payload.entries || [])
      .filter((entry) => entry?.[".tag"] === "folder" || (entry?.[".tag"] === "file" && pattern.test(entry.name || "")))
      .sort((a, b) => {
        if (a[".tag"] !== b[".tag"]) return a[".tag"] === "folder" ? -1 : 1;
        return String(a.name || "").localeCompare(String(b.name || ""));
      });
  }

  async download(path) {
    const token = await this.#accessToken();
    const response = await this.fetch("https://content.dropboxapi.com/2/files/download", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Dropbox-API-Arg": asciiJson({ path }),
      },
    });
    if (!response.ok) throw new Error("Dropbox could not download that file.");
    return response.blob();
  }

  async #accessToken() {
    if (!this.tokens?.refreshToken) throw new Error("Connect Dropbox first.");
    if (this.tokens.accessToken && Date.now() < Number(this.tokens.expiresAt || 0)) return this.tokens.accessToken;
    const response = await this.fetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.tokens.refreshToken,
        client_id: this.appKey,
      }),
    });
    if (!response.ok) {
      this.disconnect();
      throw new Error("The Dropbox connection expired. Connect it again.");
    }
    const payload = await response.json();
    this.tokens = {
      ...this.tokens,
      accessToken: payload.access_token,
      expiresAt: Date.now() + Math.max(60, Number(payload.expires_in) - 60) * 1000,
    };
    this.storage?.setItem(DROPBOX_TOKEN_KEY, JSON.stringify(this.tokens));
    return this.tokens.accessToken;
  }
}

function randomVerifier() {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

function base64Url(value) {
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
}

function asciiJson(value) {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/gu, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function readJson(value) {
  try { return value ? JSON.parse(value) : null; } catch { return null; }
}
