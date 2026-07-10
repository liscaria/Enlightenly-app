#!/usr/bin/env node
/** Smoke test: pdf.js canvasFactory renders a page in Node (vision path dependency). */
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const sampleUrl =
  "https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf";
const res = await fetch(sampleUrl);
if (!res.ok) throw new Error(`Sample PDF fetch failed: ${res.status}`);
const data = new Uint8Array(await res.arrayBuffer());

const pdf = await pdfjs.getDocument({ data }).promise;
const page = await pdf.getPage(1);
const viewport = page.getViewport({ scale: 1 });
const canvasFactory = pdf.canvasFactory;
const canvasAndContext = canvasFactory.create(
  Math.ceil(viewport.width),
  Math.ceil(viewport.height)
);
const { canvas, context } = canvasAndContext;
context.fillStyle = "#ffffff";
context.fillRect(0, 0, canvas.width, canvas.height);
await page.render({ canvasContext: context, viewport }).promise;
const buf = canvas.toBuffer("image/png");
page.cleanup();
canvasFactory.destroy(canvasAndContext);

if (!buf?.length) throw new Error("Rendered buffer empty");
console.log("pdf vision render: ok", { bytes: buf.length, pages: pdf.numPages });
