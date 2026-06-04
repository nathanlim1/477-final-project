import {cp, mkdir, readdir, rm} from "node:fs/promises";
import {existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {join} from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const dataRoot = join(root, "src", "data");
const countyRoot = join(dataRoot, "counties");
const outputRoot = join(root, "dist", "_file", "data", "counties");

await rm(outputRoot, {recursive: true, force: true});
await mkdir(outputRoot, {recursive: true});

let copied = 0;
const countyDirs = (await readdir(countyRoot, {withFileTypes: true}))
  .filter((entry) => entry.isDirectory() && /^\d{5}$/.test(entry.name))
  .map((entry) => entry.name)
  .sort();

for (const fips of countyDirs) {
  const source = join(countyRoot, fips);
  if (!existsSync(source)) continue;
  await cp(source, join(outputRoot, fips), {recursive: true});
  copied += 1;
}

console.log(`Copied ${copied} county bundles to dist.`);
