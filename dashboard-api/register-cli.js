/**
 * Standalone Node.js CLI for CSV Registration (`dashboard-api/register-cli.js`)
 *
 * Invoked by `register.ps1` or CI/CD pipelines:
 *   node dashboard-api/register-cli.js --folder="C:\path\to\csvs" --tool=jmeter [--db="..."]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { registerCsvFiles } from './ingest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const out = { folder: '', tool: 'jmeter', db: '' };
  for (const arg of argv) {
    if (arg.startsWith('--folder=')) out.folder = arg.slice('--folder='.length).replace(/^"|"$/g, '');
    else if (arg.startsWith('--rawResultsFolder=')) out.folder = arg.slice('--rawResultsFolder='.length).replace(/^"|"$/g, '');
    else if (arg.startsWith('--tool=')) out.tool = arg.slice('--tool='.length).trim().toLowerCase();
    else if (arg.startsWith('--active_tool=')) out.tool = arg.slice('--active_tool='.length).trim().toLowerCase();
    else if (arg.startsWith('--db=')) out.db = arg.slice('--db='.length).replace(/^"|"$/g, '');
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.folder || !fs.existsSync(args.folder)) {
    console.error(`ERROR: --folder must be an existing directory containing .csv files. Got: '${args.folder}'`);
    process.exit(1);
  }

  const csvNames = fs
    .readdirSync(args.folder)
    .filter((f) => /\.csv$/i.test(f))
    .sort();
  if (csvNames.length === 0) {
    console.error(`ERROR: No .csv files found in '${args.folder}'.`);
    process.exit(1);
  }

  const cfgPath = path.join(PROJECT_ROOT, 'config.yaml');
  const config = fs.existsSync(cfgPath) ? yaml.load(fs.readFileSync(cfgPath, 'utf8')) || {} : {};
  const rawDb = args.db || String(config.database_path || 'Data/Performance_Vault.db').trim();
  const dbPath = path.isAbsolute(rawDb) ? rawDb : path.resolve(PROJECT_ROOT, rawDb);

  const files = csvNames.map((name) => ({
    filePath: path.join(args.folder, name),
    originalName: name,
  }));

  console.log(`>>> [Perf-Delta Node Ingest] Registering ${files.length} CSV file(s) from '${args.folder}' (tool=${args.tool})...`);
  const res = await registerCsvFiles({ files, toolType: args.tool, dbPath, config });
  console.log(
    `>>> [SUCCESS] Registered Run ID '${res.runId}' (Seq #${res.sequenceNum}) | ${res.projectName} - ${res.testName} | ${res.totalSamples.toLocaleString()} samples | Peak VUs=${res.peakVUs} | P95=${res.p95Rt}ms (${res.elapsedMs}ms)`
  );
}

main().catch((err) => {
  console.error(`>>> [ERROR] ${err?.message || err}`);
  process.exit(1);
});
