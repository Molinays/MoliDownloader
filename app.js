/* MoliDowloader — sito ufficiale · Copyright © 2026 Molinays · MIT */
'use strict';

const REPO = 'Molinays/MoliDownloader';
const RELEASES = `https://github.com/${REPO}/releases/latest`;

const setupBtn = document.getElementById('dlSetup');
const setupCard = document.getElementById('dlSetupCard');
const portableBtn = document.getElementById('dlPortable');
const releaseMeta = document.getElementById('releaseMeta');
const setupMeta = document.getElementById('setupMeta');
const portableMeta = document.getElementById('portableMeta');

function mb(bytes) {
  const value = Number(bytes) || 0;
  if (!value) return '';
  return `${(value / (1024 * 1024)).toFixed(0)} MB`;
}

function setButton(primary, secondary, asset, label) {
  if (!asset) return;
  for (const node of [primary, secondary]) {
    if (!node) continue;
    node.href = asset.browser_download_url;
    node.setAttribute('download', '');
    if (label) node.textContent = label;
  }
}

async function loadLatestRelease() {
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const release = await response.json();
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const setup = assets.find((asset) => /^MoliDowloader-Setup-[\d.]+\.exe$/i.test(asset.name));
    const portable = assets.find(
      (asset) => /^MoliDowloader-[\d.]+\.exe$/i.test(asset.name) && !/setup/i.test(asset.name),
    );
    const version = String(release.tag_name || '').replace(/^v/i, '');

    setButton(setupBtn, setupCard, setup, 'Scarica per Windows');
    setButton(null, portableBtn, portable, 'Scarica il portable');

    if (version) {
      if (releaseMeta) {
        releaseMeta.textContent = `Versione ${version}${setup ? ` · ${mb(setup.size)}` : ''} · Windows 10/11 · 64-bit`;
      }
      if (setup && setupMeta) setupMeta.textContent = `${setup.name} · ${mb(setup.size)}`;
      if (portable && portableMeta) portableMeta.textContent = `${portable.name} · ${mb(portable.size)}`;
    }
    document.documentElement.dataset.release = version || 'unknown';
  } catch {
    // Senza rete o con l'API limitata restano i link alla pagina delle release.
    for (const node of [setupBtn, setupCard, portableBtn]) {
      if (node) node.href = RELEASES;
    }
    if (releaseMeta) releaseMeta.textContent = 'Ultima versione su GitHub · Windows 10/11 · 64-bit';
    if (setupMeta) setupMeta.textContent = 'MoliDowloader-Setup-<versione>.exe';
    if (portableMeta) portableMeta.textContent = 'MoliDowloader-<versione>.exe';
  }
}

loadLatestRelease();
