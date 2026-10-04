// Renders public/icons/icon.svg to the PNG sizes the web app manifest lists, using the same Chromium the tests use.
// usage: node tools/make-icons.mjs
import fs from "node:fs";
import { launch } from "../harness.mjs";

const svg = fs.readFileSync(new URL("../public/icons/icon.svg", import.meta.url), "utf8");
const browser = await launch();
// a "maskable" icon must keep its content inside the centre 80 percent, because the launcher may crop the edges
const render = async (size, { maskable = false } = {}) => {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const inner = maskable ? `<div style="position:absolute;inset:${size * 0.1}px">${svg}</div>` : svg;
  await page.setContent(`<body style="margin:0;background:${maskable ? "#04060c" : "transparent"};width:${size}px;height:${size}px;position:relative"><div style="position:absolute;inset:0">${maskable ? inner : svg}</div><style>svg{width:100%;height:100%;display:block}</style></body>`);
  const buf = await page.screenshot({ omitBackground: !maskable, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
  return buf;
};
for (const [name, size, opts] of [["icon-192.png", 192, {}], ["icon-512.png", 512, {}], ["icon-maskable-512.png", 512, { maskable: true }], ["apple-touch-icon.png", 180, {}]]) {
  fs.writeFileSync(new URL(`../public/icons/${name}`, import.meta.url), await render(size, opts));
  console.log(name);
}
await browser.close();
