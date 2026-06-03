import {cp, mkdir, readFile, rm} from "node:fs/promises";
import {existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {join} from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const dataRoot = join(root, "src", "data");
const outputRoot = join(root, "dist", "_file", "data", "counties");
const index = JSON.parse(await readFile(join(dataRoot, "ca-county-index.json"), "utf8"));

await rm(outputRoot, {recursive: true, force: true});
await mkdir(outputRoot, {recursive: true});

let copied = 0;
for (const county of index.counties) {
  const source = join(dataRoot, "counties", county.fips);
  if (!existsSync(source)) continue;
  await cp(source, join(outputRoot, county.fips), {recursive: true});
  copied += 1;
}

console.log(`Copied ${copied} county bundles to dist.`);
