/*
 * MoliDowloader — Copyright © 2026 Molinays. MIT License.
 *
 * Riscrive il branch main di GitHub con un commit che contiene SOLO il README
 * pubblico (nessun sorgente), sposta i tag delle release sullo stesso commit e
 * verifica che release, latest.yml e auto-update restino raggiungibili.
 *
 * Uso:
 *   node scripts/rewrite-public-repo.mjs          (chiede conferma)
 *   node scripts/rewrite-public-repo.mjs --yes    (nessuna domanda)
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const readmePath = path.join(scriptDir, 'public-README.md');
const EXPECTED_REMOTE_MAIN = 'a4b091b1c541181f556322ae60f2886a3615db6b';
const EXPECTED_HEAD = 'a4b091b1c541181f556322ae60f2886a3615db6b';
const TAGS = ['v2.3.0', 'v2.3.1'];
const REMOTE_PATTERN = /Molinays\/MoliDownloader(\.git)?$/;

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

function fail(message) {
  console.error(`\nERRORE: ${message}\n`);
  process.exit(1);
}

console.log('== MoliDowloader: repo pubblico senza sorgente ==');
console.log(`Cartella: ${repoRoot}`);

if (!fs.existsSync(path.join(repoRoot, '.git'))) fail('Questa cartella non è un repository git.');
if (!fs.existsSync(readmePath)) fail(`README pubblico mancante: ${readmePath}`);

const remote = git(['remote', 'get-url', 'origin']);
if (!REMOTE_PATTERN.test(remote)) {
  fail(`Il remote origin non punta a Molinays/MoliDownloader: ${remote}`);
}

const head = git(['rev-parse', 'HEAD']);
if (head !== EXPECTED_HEAD) {
  fail(
    `HEAD è ${head} invece di ${EXPECTED_HEAD}. Il progetto è cambiato dopo la release 2.3.1: aggiorna EXPECTED_HEAD nello script dopo aver controllato le modifiche.`,
  );
}

const lsRemote = git(['ls-remote', 'origin', 'refs/heads/main']);
const remoteMain = (lsRemote.split(/\s+/)[0] || '').trim();
if (remoteMain !== EXPECTED_REMOTE_MAIN) {
  fail(`origin/main è ${remoteMain || 'assente'} invece di ${EXPECTED_REMOTE_MAIN}: qualcuno ha pushato dopo. Non tocco nulla.`);
}

const readme = fs.readFileSync(readmePath, 'utf8');
console.log('\nCosa succede:');
console.log('- creo un commit con solo README.md (nessun file di codice)');
console.log(`- sposto origin/main da ${remoteMain.slice(0, 7)} al nuovo commit (force, con lease)`);
console.log(`- sposto i tag ${TAGS.join(', ')} sullo stesso commit (le release restano attive)`);
console.log('- salvo backup locale: branch "dev" e tag "backup-source-2.3.1"');
console.log('- verifico che latest.yml e l\'API delle release funzionino ancora');

const confirmed =
  process.argv.includes('--yes') ||
  process.env.MOLI_CONFIRM === 'SI' ||
  (await (async () => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question('\nScrivi SI per procedere: ')).trim().toUpperCase();
    rl.close();
    return answer === 'SI';
  })());

if (!confirmed) {
  console.log('Annullato, nessuna modifica eseguita.');
  process.exit(0);
}

console.log('\n[1/5] Backup locale...');
git(['branch', '-f', 'dev', head]);
git(['tag', '-f', 'backup-source-2.3.1', head]);
console.log(`      branch dev e tag backup-source-2.3.1 -> ${head.slice(0, 7)}`);

console.log('[2/5] Creo il commit release-only...');
const blob = git(['hash-object', '-w', '--stdin'], { input: readme });
const tree = git(['mktree'], { input: `100644 blob ${blob}\tREADME.md\n` });
const commit = git(['commit-tree', tree, '-m', 'Distribuzione: solo eseguibili (nessun sorgente)']);
git(['update-ref', 'refs/heads/release-only', commit]);
console.log(`      commit ${commit.slice(0, 7)} con: ${git(['ls-tree', '-r', '--name-only', commit]).split('\n').filter(Boolean).join(', ')}`);

console.log('[3/5] Aggiorno origin/main...');
git([
  'push',
  `--force-with-lease=refs/heads/main:${remoteMain}`,
  'origin',
  `${commit}:refs/heads/main`,
]);
console.log('      main aggiornato');

console.log('[4/5] Sposto i tag delle release...');
const tagFailures = [];
for (const tag of TAGS) {
  try {
    git(['tag', '-f', tag, commit]);
    git(['push', '--force', 'origin', `+refs/tags/${tag}:refs/tags/${tag}`]);
    console.log(`      ${tag} -> ${commit.slice(0, 7)}`);
  } catch (error) {
    tagFailures.push(tag);
    console.error(`      ${tag}: non aggiornato (${String(error.stderr || error.message).trim().split('\n').pop()})`);
  }
}

console.log('[5/5] Verifica...');
git(['fetch', 'origin', '--tags', '--force']);
try {
  git(['branch', '--unset-upstream', 'main']);
  console.log('      upstream di main rimosso: lo sviluppo resta sul branch locale dev');
} catch {
  /* nessun upstream da rimuovere */
}
const mainTree = git(['ls-tree', '-r', '--name-only', 'origin/main']).split('\n').filter(Boolean);
console.log(`      origin/main contiene: ${mainTree.join(', ') || '(vuoto)'}`);
if (mainTree.length !== 1 || mainTree[0] !== 'README.md') {
  console.error('      ATTENZIONE: il tree remoto non contiene solo README.md');
}

try {
  const releaseResponse = await fetch('https://api.github.com/repos/Molinays/MoliDownloader/releases/latest', {
    headers: { 'User-Agent': 'MoliDowloader-release-check' },
  });
  const release = await releaseResponse.json();
  console.log(`      release latest: ${release.tag_name || '?'} (HTTP ${releaseResponse.status})`);
  console.log(`      asset: ${(release.assets || []).map((asset) => asset.name).join(', ') || 'nessuno'}`);
} catch (error) {
  console.error(`      API release non raggiungibile: ${error.message}`);
}

try {
  const ymlResponse = await fetch('https://github.com/Molinays/MoliDownloader/releases/latest/download/latest.yml', {
    headers: { 'User-Agent': 'MoliDowloader-release-check' },
  });
  const yml = await ymlResponse.text();
  console.log(`      latest.yml: HTTP ${ymlResponse.status}`);
  console.log(
    yml
      .split('\n')
      .slice(0, 4)
      .map((line) => `        ${line}`)
      .join('\n'),
  );
} catch (error) {
  console.error(`      latest.yml non raggiungibile: ${error.message}`);
}

console.log('\nFatto.');
console.log('Locale: il sorgente resta nel branch "dev" (qui) e nel backup "backup-source-2.3.1".');
console.log('GitHub: main contiene solo il README pubblico; i vecchi commit potrebbero restare leggibili via SHA finché GitHub non fa pulizia.');
console.log('Prossime release: il workflow GitHub Actions non esiste più nel repo pubblico, quindi vanno costruite e caricate da qui (npm run dist + upload degli asset).');
if (tagFailures.length) {
  console.log(`\nTag non aggiornati: ${tagFailures.join(', ')}. In quel caso cancella e ricrea le release corrispondenti via interfaccia GitHub.`);
}
