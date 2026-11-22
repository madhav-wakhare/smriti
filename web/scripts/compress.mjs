// After `vite build`: write .br and .gz next to every compressible file in dist/assets, so the API
// can send them as-is (no compression work per request). Uses Node's own zlib; no extra packages.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const dir = "dist/assets";
let before = 0;
let after = 0;
for (const name of readdirSync(dir)) {
  if (!/\.(js|css|svg|json)$/.test(name)) continue;
  const data = readFileSync(join(dir, name));
  const br = brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } });
  writeFileSync(join(dir, `${name}.br`), br);
  writeFileSync(join(dir, `${name}.gz`), gzipSync(data, { level: 9 }));
  before += data.length;
  after += br.length;
}
console.log(`compressed assets: ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB (brotli)`);
