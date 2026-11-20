// Token launch radar — entrypoint.
//
// Run it from the repository root:
//
//   node main.ts --input /input/snapshot.json
//
// It reads the sealed snapshot, scores the board with the model in
// lib/model.ts, and writes everything the entry hands in into the
// output directory:
//
//   board.json      the ranked board, one row per candidate protocol
//   data.js         the same board plus the live comps, for the page
//   dashboard/      a copy of this repository's dashboard/
//   screenshots/    a copy of this repository's screenshots/
//   dossier.json    the dossier buildDossier writes from those files
//
// The output directory comes from MAKEFUN_OUTPUT_DIR, or /output when
// the variable is not set. The input path comes from --input, or
// /input/snapshot.json when the flag is not given. Nothing is read from
// the network and nothing depends on the clock: two runs on the same
// snapshot write the same bytes.

import { readFileSync, writeFileSync, mkdirSync, cpSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildDossier } from "./vendor/makefun-board.ts";
import { buildBoard, buildPayload } from "./lib/model.ts";

function flagValue(argv: string[], flag: string, fallback: string): string {
  const at = argv.indexOf(flag);
  if (at >= 0 && at + 1 < argv.length) return argv[at + 1];
  return fallback;
}

function main(): void {
  const argv = process.argv.slice(2);
  const inputPath = flagValue(argv, "--input", "/input/snapshot.json");
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";

  const raw = readFileSync(inputPath, "utf8");
  const snapshot = JSON.parse(raw);

  const rows = buildBoard(snapshot);
  const payload = buildPayload(snapshot);
  const watchlistCovered = payload.watchlist.filter((slug) =>
    rows.some((row) => row.slug === slug)
  ).length;
  const earlyRows = payload.early_size;
  const liveRows = payload.live_size;

  mkdirSync(outDir, { recursive: true });

  // The board: the ranked rows, pretty-printed so a reader can open it.
  writeFileSync(
    join(outDir, "board.json"),
    JSON.stringify({ rows }, null, 2) + "\n",
    "utf8"
  );

  // The page's data: the same rows plus the live comps, as one global
  // the dashboard script reads. Written compact, with the keys in the
  // order buildPayload put them in, so the bytes are stable run to run.
  writeFileSync(
    join(outDir, "data.js"),
    "window.RADAR=" + JSON.stringify(payload) + ";\n",
    "utf8"
  );

  // The dashboard and its screenshots, copied whole.
  cpSync(join("dashboard"), join(outDir, "dashboard"), { recursive: true });
  cpSync(join("screenshots"), join(outDir, "screenshots"), { recursive: true });

  // The dossier: exactly the bytes the vendor library writes from the
  // dashboard and the screenshots in this output directory.
  const dossier = buildDossier(outDir, { text_max_bytes: 65536 });
  writeFileSync(join(outDir, "dossier.json"), dossier);

  console.log(
    `token radar: ${snapshot.protocols.length} protocols, ` +
      `${watchlistCovered} of ${payload.watchlist_size} watchlist covered, ` +
      `${rows.length} rows scored (${earlyRows} early, ${liveRows} live set aside)`
  );
  const dashboardFiles = readdirSync(join(outDir, "dashboard")).length;
  const screenshotFiles = readdirSync(join(outDir, "screenshots")).length;
  console.log(
    `token radar: wrote ${join(outDir, "board.json")}, ` +
      `${join(outDir, "data.js")}, ` +
      `${join(outDir, "dashboard")} (${dashboardFiles} files), ` +
      `${join(outDir, "screenshots")} (${screenshotFiles} images) and ` +
      `${join(outDir, "dossier.json")}`
  );
}

main();
