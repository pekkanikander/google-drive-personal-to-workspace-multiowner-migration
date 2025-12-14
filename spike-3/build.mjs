import esbuild from "esbuild";

const watchMode = process.argv.includes("--watch");

const commonOptions = {
  entryPoints: ["src/app.ts"],
  bundle: true,
  outfile: "public/app.js",
  format: "iife",
  sourcemap: true
};

async function run() {
  if (watchMode) {
    const ctx = await esbuild.context(commonOptions);
    await ctx.watch();
    console.log("esbuild is watching for changes...");
  } else {
    await esbuild.build(commonOptions);
    console.log("Build complete.");
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
