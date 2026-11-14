import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const clientId = process.env.SPOOT_SPOTIFY_CLIENT_ID || "3bce8856f88743c08e3e0bddcefd53eb";
const cssFiles = [
  "src/styles/tokens.css",
  "src/styles/base.css",
  "src/styles/player.css",
  "src/styles/widgets.css",
  "src/styles/modals.css",
  "src/styles/immersive.css",
];
const svgAssets = [
  "src/assets/mock-cover-silver.svg",
  "src/assets/mock-cover-orbit.svg",
  "src/assets/mock-cover-night.svg",
];

const singleConfigPlugin = {
  name: "single-config",
  setup(context) {
    context.onResolve({ filter: /config\.local\.js$/ }, () => ({
      path: "spoot-single-config",
      namespace: "single-config",
    }));
    context.onLoad({ filter: /.*/, namespace: "single-config" }, () => ({
      loader: "js",
      contents: [
        `export const SPOTIFY_CLIENT_ID = ${JSON.stringify(clientId)};`,
        "export const SPOTIFY_REDIRECT_URI = globalThis.location && globalThis.location.protocol !== 'file:'",
        "  ? `${globalThis.location.origin}${globalThis.location.pathname}`",
        "  : 'https://www.kasandbox.org/';",
        "export const SPOTIFY_DEVICE_NAME = 'Spoot';",
      ].join("\n"),
    }));
  },
};

const [bundleResult, shell, favicon, font] = await Promise.all([
  build({
    entryPoints: [resolve(root, "src/js/app.js")],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    write: false,
    plugins: [singleConfigPlugin],
  }),
  readFile(resolve(root, "index.html"), "utf8"),
  readFile(resolve(root, "src/assets/favicon.svg")),
  readFile(resolve(root, "src/assets/inter-latin.woff2")),
]);

let bundle = bundleResult.outputFiles[0].text;
for (const asset of svgAssets) {
  const encoded = (await readFile(resolve(root, asset))).toString("base64");
  bundle = bundle.split(`./${asset}`).join(`data:image/svg+xml;base64,${encoded}`);
}
if (/<\/script/iu.test(bundle)) throw new Error("The bundle contains a closing script sequence.");

const fontDataUrl = `data:font/woff2;base64,${font.toString("base64")}`;
const css = (await Promise.all(cssFiles.map(async (file) => {
  let source = await readFile(resolve(root, file), "utf8");
  source = source.replace("../assets/inter-latin.woff2", fontDataUrl);
  return `/* ${file} */\n${source.trim()}`;
}))).join("\n\n");

let html = shell.replace(/\r\n?/gu, "\n");
html = html.replace(
  /<link rel="icon" href="\.\/src\/assets\/favicon\.svg" type="image\/svg\+xml">/u,
  `<link rel="icon" href="data:image/svg+xml;base64,${favicon.toString("base64")}" type="image/svg+xml">`,
);
const localStyles = /^\s*<link rel="stylesheet" href="\.\/src\/styles\/[^"]+">\n/gmu;
if ((html.match(localStyles) || []).length !== cssFiles.length) {
  throw new Error("The index stylesheet list no longer matches the one-file builder.");
}
html = html.replace(localStyles, "");
html = html.replace("</head>", () => `  <style>\n${css}\n  </style>\n</head>`);

const entry = /\s*<script type="module" src="\.\/src\/js\/app\.js[^"]*"><\/script>/u;
if (!entry.test(html)) throw new Error("The index module entrypoint was not found.");
html = html.replace(entry, () => `\n  <script type="module">\n${bundle.trimEnd()}\n  </script>`);
html = html.replace(
  "<!doctype html>",
  "<!doctype html>\n<!-- Generated one-file Spoot build. Serve over HTTP and register this exact page URL as Spotify's redirect URI. -->",
);

const localRuntimeReference = /\.\/src\/(?:js|styles|assets)\//u.exec(html)?.[0];
if (localRuntimeReference) throw new Error(`Unbundled runtime reference: ${localRuntimeReference}`);
if (!html.includes(clientId)) throw new Error("The one-file Spotify Client ID was not embedded.");
if (!html.includes(fontDataUrl)) throw new Error("The one-file font was not embedded.");

await writeFile(resolve(root, "single.html"), `${html.trimEnd()}\n`, "utf8");
console.log(`Built single.html (${Buffer.byteLength(html)} bytes).`);
