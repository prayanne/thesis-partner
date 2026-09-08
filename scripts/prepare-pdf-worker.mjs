import { copyFile, cp, mkdir } from "node:fs/promises";
import path from "node:path";
const destination = path.resolve("apps/web/public/vendor/pdfjs");
await mkdir(destination, { recursive: true });
await copyFile(
  path.resolve("node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs"),
  path.join(destination, "pdf.worker.legacy.min.mjs"),
);
for (const directory of ["cmaps", "standard_fonts", "wasm"])
  await cp(
    path.resolve("node_modules/pdfjs-dist", directory),
    path.join(destination, directory),
    { recursive: true },
  );
console.log("Pinned PDF.js browser assets prepared locally.");
