const ALIASES = Object.freeze({
  p: "play",
  resume: "play",
  stop: "pause",
  n: "next",
  skip: "next",
  previous: "prev",
  back: "prev",
  sh: "shuffle",
  rep: "repeat",
  loop: "repeat",
  vol: "volume",
  v: "volume",
  q: "queue",
  im: "fullscreen",
  immersive: "fullscreen",
  tv: "fullscreen",
  find: "search",
  lib: "library",
  l: "lyrics",
});

let cleanup;
let active = false;
let handlers = {};

export function setupCommandPalette(nextHandlers = {}) {
  cleanup?.();
  handlers = { ...nextHandlers };
  const palette = document.getElementById("command-palette");
  const form = document.getElementById("command-form");
  const input = document.getElementById("command-input");
  if (!palette || !form || !input) return () => {};

  const submit = async (event) => {
    event.preventDefault();
    const parsed = parseCommand(input.value);
    if (!parsed) return;
    try {
      const result = await handlers.onCommand?.(parsed);
      if (result?.keepOpen) {
        renderCommandOutput(result.message || "");
        return;
      }
      closeCommandPalette();
    } catch (error) {
      renderCommandOutput(error?.message || "That command could not be completed.", { error: true });
    }
  };
  const keydown = (event) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      closeCommandPalette();
    }
  };
  const blur = (event) => {
    if (!active || palette.contains(event.relatedTarget)) return;
    setTimeout(() => {
      if (active && !palette.contains(document.activeElement)) closeCommandPalette();
    }, 0);
  };
  form.addEventListener("submit", submit);
  input.addEventListener("keydown", keydown);
  palette.addEventListener("focusout", blur);
  cleanup = () => {
    form.removeEventListener("submit", submit);
    input.removeEventListener("keydown", keydown);
    palette.removeEventListener("focusout", blur);
    handlers = {};
    cleanup = undefined;
  };
  return cleanup;
}

export function openCommandPalette() {
  const palette = document.getElementById("command-palette");
  const input = document.getElementById("command-input");
  if (!palette || !input) return false;
  active = true;
  palette.classList.add("show");
  palette.setAttribute("aria-hidden", "false");
  renderCommandOutput("");
  requestAnimationFrame(() => {
    input.focus({ preventScroll: true });
    input.select();
  });
  return true;
}

export function closeCommandPalette() {
  const palette = document.getElementById("command-palette");
  const input = document.getElementById("command-input");
  active = false;
  palette?.classList.remove("show", "has-output");
  palette?.setAttribute("aria-hidden", "true");
  input?.blur();
}

export function isCommandPaletteOpen() {
  return active;
}

export function renderCommandOutput(message, { error = false } = {}) {
  const palette = document.getElementById("command-palette");
  const output = document.getElementById("command-output");
  if (!palette || !output) return;
  output.replaceChildren();
  palette.classList.toggle("has-output", Boolean(message));
  if (!message) return;
  const text = document.createElement("div");
  text.className = `command-message${error ? " error" : ""}`;
  text.textContent = message;
  output.append(text);
}

export function parseCommand(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const [token, ...rest] = tokenize(raw);
  const lower = token.toLowerCase();
  const name = ALIASES[lower] || lower;
  return {
    raw,
    name,
    args: rest,
    argument: rest.join(" ").trim(),
  };
}

export function parseSeekArgument(value, currentMs = 0) {
  const input = String(value || "").trim();
  if (!input) return null;
  const relative = /^[+-]/u.test(input);
  const sign = input.startsWith("-") ? -1 : 1;
  const unsigned = input.replace(/^[+-]/u, "");
  let seconds;
  if (/^\d+(?:\.\d+)?$/u.test(unsigned)) seconds = Number(unsigned);
  else {
    const match = unsigned.match(/^(?:(\d+):)?([0-5]?\d)(?:\.(\d+))?$/u);
    if (!match) return null;
    seconds = Number(match[1] || 0) * 60 + Number(match[2]) + Number(`0.${match[3] || 0}`);
  }
  const target = (relative ? Number(currentMs || 0) : 0) + sign * seconds * 1000;
  return Math.max(0, Math.round(target));
}

function tokenize(value) {
  const tokens = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/gu;
  for (const match of value.matchAll(pattern)) tokens.push(match[1] ?? match[2] ?? match[3]);
  return tokens;
}
