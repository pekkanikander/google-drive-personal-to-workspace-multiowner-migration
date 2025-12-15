import { build } from "esbuild";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const dist = resolve(root, "dist");

rmSync(dist, { recursive: true, force: true });

const entryPoints = {
  "admin": resolve(root, "src/admin/index.ts"),
  "user": resolve(root, "src/user/index.ts"),
};

const sharedOptions = {
  bundle: true,
  format: "esm",
  sourcemap: true,
  target: "es2020",
  outdir: dist,
  logLevel: "info",
};

const result = await build({
  entryPoints,
  splitting: true,
  chunkNames: "chunks/[name]-[hash]",
  ...sharedOptions,
});

if (result.errors?.length) {
  process.exit(1);
}
