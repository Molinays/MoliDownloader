/* MoliDowloader — Copyright © 2026 Molinays · SPDX-License-Identifier: MIT */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

const X264_PRESETS = [
  { value: 'ultrafast', label: 'Ultrafast' },
  { value: 'superfast', label: 'Superfast' },
  { value: 'veryfast', label: 'Very fast' },
  { value: 'faster', label: 'Faster' },
  { value: 'fast', label: 'Fast' },
  { value: 'medium', label: 'Medium (default)' },
  { value: 'slow', label: 'Slow' },
  { value: 'slower', label: 'Slower' },
  { value: 'veryslow', label: 'Very slow' },
  { value: 'placebo', label: 'Placebo (lentissimo)' },
];

const AOM_PRESETS = [
  { value: '0', label: '0 · maximum quality' },
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
  { value: '4', label: '4' },
  { value: '5', label: '5' },
  { value: '6', label: '6 · balanced' },
  { value: '7', label: '7' },
  { value: '8', label: '8 · maximum speed' },
];

const VP9_PRESETS = [
  { value: '0', label: '0 · maximum quality' },
  { value: '1', label: '1' },
  { value: '2', label: '2 · balanced' },
  { value: '3', label: '3' },
  { value: '4', label: '4' },
  { value: '5', label: '5' },
  { value: '6', label: '6 · fast' },
  { value: '7', label: '7' },
  { value: '8', label: '8 · maximum speed' },
];

const NVENC_PRESETS = [
  { value: 'p1', label: 'P1 · maximum speed' },
  { value: 'p2', label: 'P2' },
  { value: 'p3', label: 'P3' },
  { value: 'p4', label: 'P4 · fast' },
  { value: 'p5', label: 'P5 · balanced' },
  { value: 'p6', label: 'P6 · quality' },
  { value: 'p7', label: 'P7 · maximum quality' },
];

const QSV_PRESETS = [
  { value: 'veryfast', label: 'Very fast' },
  { value: 'faster', label: 'Faster' },
  { value: 'fast', label: 'Fast' },
  { value: 'medium', label: 'Medium' },
  { value: 'slow', label: 'Slow' },
  { value: 'slower', label: 'Slower' },
  { value: 'veryslow', label: 'Very slow' },
];

const AMF_H264_PRESETS = [
  { value: '0', label: 'Speed' },
  { value: '1', label: 'Balanced' },
  { value: '2', label: 'Quality' },
];

const AMF_HEVC_PRESETS = [
  { value: '0', label: 'Speed' },
  { value: '5', label: 'Balanced' },
  { value: '10', label: 'Quality' },
];

const AMF_AV1_PRESETS = [
  { value: '0', label: 'Speed' },
  { value: '50', label: 'Balanced' },
  { value: '100', label: 'Quality' },
];

const LEVELS = ['auto', '3.0', '3.1', '4.0', '4.1', '4.2', '5.0', '5.1', '5.2', '6.0', '6.1', '6.2'];

const VIDEO_ENCODERS = [
  {
    id: 'libx265',
    label: 'H.265 / HEVC · x265 (software)',
    short: 'H.265 x265',
    family: 'x265',
    codec: 'hevc',
    hardware: false,
    containers: ['mp4', 'mkv'],
    presets: X264_PRESETS,
    defaultPreset: 'medium',
    tunes: ['', 'film', 'animation', 'grain', 'stillimage', 'fastdecode', 'zerolatency'],
    profiles: ['auto', 'main', 'main10', 'mainstillpicture'],
    quality: { min: 0, max: 51, step: 1, default: 24, label: 'CRF' },
    twoPass: true,
    customParam: 'x265-params',
    pixelFormats: ['auto', 'yuv420p', 'yuv420p10le', 'yuv422p', 'yuv444p'],
  },
  {
    id: 'libx264',
    label: 'H.264 / AVC · x264 (software)',
    short: 'H.264 x264',
    family: 'x264',
    codec: 'h264',
    hardware: false,
    containers: ['mp4', 'mkv'],
    presets: X264_PRESETS,
    defaultPreset: 'medium',
    tunes: ['', 'film', 'animation', 'grain', 'stillimage', 'fastdecode', 'zerolatency'],
    profiles: ['auto', 'baseline', 'main', 'high', 'high10', 'high422', 'high444'],
    quality: { min: 0, max: 51, step: 1, default: 23, label: 'CRF' },
    twoPass: true,
    customParam: 'x264-params',
    pixelFormats: ['auto', 'yuv420p', 'yuv420p10le', 'yuv422p', 'yuv444p'],
  },
  {
    id: 'libaom-av1',
    label: 'AV1 · libaom (software, slow)',
    short: 'AV1 libaom',
    family: 'aom',
    codec: 'av1',
    hardware: false,
    containers: ['mp4', 'mkv', 'webm'],
    presets: AOM_PRESETS,
    defaultPreset: '6',
    tunes: [],
    profiles: ['auto', 'main'],
    quality: { min: 0, max: 63, step: 1, default: 30, label: 'CRF' },
    twoPass: false,
    customParam: null,
    pixelFormats: ['auto', 'yuv420p', 'yuv420p10le'],
  },
  {
    id: 'libvpx-vp9',
    label: 'VP9 · libvpx (software)',
    short: 'VP9',
    family: 'vp9',
    codec: 'vp9',
    hardware: false,
    containers: ['mkv', 'webm'],
    presets: VP9_PRESETS,
    defaultPreset: '2',
    tunes: [],
    profiles: ['auto', '0', '1', '2', '3'],
    quality: { min: 0, max: 63, step: 1, default: 32, label: 'CRF' },
    twoPass: false,
    customParam: null,
    pixelFormats: ['auto', 'yuv420p', 'yuv420p10le'],
  },
  {
    id: 'hevc_nvenc',
    label: 'H.265 / HEVC · NVIDIA NVENC',
    short: 'HEVC NVENC',
    family: 'nvenc',
    codec: 'hevc',
    hardware: true,
    vendor: 'nvidia',
    containers: ['mp4', 'mkv'],
    presets: NVENC_PRESETS,
    defaultPreset: 'p5',
    tunes: ['hq', 'll', 'ull', 'lossless'],
    profiles: ['auto', 'main', 'main10', 'rext'],
    quality: { min: 0, max: 51, step: 1, default: 24, label: 'CQ' },
    twoPass: false,
    customParam: null,
    pixelFormats: ['auto', 'yuv420p', 'p010le', 'yuv444p'],
  },
  {
    id: 'h264_nvenc',
    label: 'H.264 / AVC · NVIDIA NVENC',
    short: 'H.264 NVENC',
    family: 'nvenc',
    codec: 'h264',
    hardware: true,
    vendor: 'nvidia',
    containers: ['mp4', 'mkv'],
    presets: NVENC_PRESETS,
    defaultPreset: 'p4',
    tunes: ['hq', 'll', 'ull', 'lossless'],
    profiles: ['auto', 'baseline', 'main', 'high', 'high444p'],
    quality: { min: 0, max: 51, step: 1, default: 23, label: 'CQ' },
    twoPass: false,
    customParam: null,
    pixelFormats: ['auto', 'yuv420p', 'yuv444p'],
  },
  {
    id: 'av1_nvenc',
    label: 'AV1 · NVIDIA NVENC',
    short: 'AV1 NVENC',
    family: 'nvenc',
    codec: 'av1',
    hardware: true,
    vendor: 'nvidia',
    containers: ['mp4', 'mkv', 'webm'],
    presets: NVENC_PRESETS,
    defaultPreset: 'p5',
    tunes: ['hq', 'll', 'ull', 'lossless'],
    profiles: ['auto', 'main'],
    quality: { min: 0, max: 51, step: 1, default: 26, label: 'CQ' },
    twoPass: false,
    customParam: null,
    pixelFormats: ['auto', 'yuv420p', 'p010le'],
  },
  {
    id: 'hevc_qsv',
    label: 'H.265 / HEVC · Intel Quick Sync',
    short: 'HEVC QSV',
    family: 'qsv',
    codec: 'hevc',
    hardware: true,
    vendor: 'intel',
    containers: ['mp4', 'mkv'],
    presets: QSV_PRESETS,
    defaultPreset: 'medium',
    tunes: [],
    profiles: ['auto', 'main', 'main10'],
    quality: { min: 1, max: 51, step: 1, default: 24, label: 'Quality' },
    twoPass: false,
    customParam: null,
    pixelFormats: ['auto', 'nv12', 'p010le'],
  },
  {
    id: 'h264_qsv',
    label: 'H.264 / AVC · Intel Quick Sync',
    short: 'H.264 QSV',
    family: 'qsv',
    codec: 'h264',
    hardware: true,
    vendor: 'intel',
    containers: ['mp4', 'mkv'],
    presets: QSV_PRESETS,
    defaultPreset: 'medium',
    tunes: [],
    profiles: ['auto', 'baseline', 'main', 'high'],
    quality: { min: 1, max: 51, step: 1, default: 23, label: 'Quality' },
    twoPass: false,
    customParam: null,
    pixelFormats: ['auto', 'nv12', 'yuv420p'],
  },
  {
    id: 'av1_qsv',
    label: 'AV1 · Intel Quick Sync',
    short: 'AV1 QSV',
    family: 'qsv',
    codec: 'av1',
    hardware: true,
    vendor: 'intel',
    containers: ['mp4', 'mkv', 'webm'],
    presets: QSV_PRESETS,
    defaultPreset: 'medium',
    tunes: [],
    profiles: ['auto', 'main'],
    quality: { min: 1, max: 51, step: 1, default: 26, label: 'Quality' },
    twoPass: false,
    customParam: null,
    pixelFormats: ['auto', 'nv12', 'p010le'],
  },
  {
    id: 'hevc_amf',
    label: 'H.265 / HEVC · AMD AMF',
    short: 'HEVC AMF',
    family: 'amf',
    codec: 'hevc',
    hardware: true,
    vendor: 'amd',
    containers: ['mp4', 'mkv'],
    presets: AMF_HEVC_PRESETS,
    defaultPreset: '5',
    tunes: [],
    profiles: ['auto', 'main', 'main10'],
    quality: { min: 0, max: 51, step: 1, default: 24, label: 'QP' },
    twoPass: false,
    customParam: null,
    pixelFormats: ['auto', 'yuv420p', 'p010le'],
  },
  {
    id: 'h264_amf',
    label: 'H.264 / AVC · AMD AMF',
    short: 'H.264 AMF',
    family: 'amf',
    codec: 'h264',
    hardware: true,
    vendor: 'amd',
    containers: ['mp4', 'mkv'],
    presets: AMF_H264_PRESETS,
    defaultPreset: '1',
    tunes: [],
    profiles: ['auto', 'baseline', 'main', 'high'],
    quality: { min: 0, max: 51, step: 1, default: 23, label: 'QP' },
    twoPass: false,
    customParam: null,
    pixelFormats: ['auto', 'yuv420p'],
  },
  {
    id: 'av1_amf',
    label: 'AV1 · AMD AMF',
    short: 'AV1 AMF',
    family: 'amf',
    codec: 'av1',
    hardware: true,
    vendor: 'amd',
    containers: ['mp4', 'mkv', 'webm'],
    presets: AMF_AV1_PRESETS,
    defaultPreset: '50',
    tunes: [],
    profiles: ['auto', 'main'],
    quality: { min: 0, max: 51, step: 1, default: 26, label: 'QP' },
    twoPass: false,
    customParam: null,
    pixelFormats: ['auto', 'yuv420p', 'p010le'],
  },
  {
    id: 'hevc_videotoolbox',
    label: 'H.265 / HEVC · Apple VideoToolbox',
    short: 'HEVC VideoToolbox',
    family: 'videotoolbox',
    codec: 'hevc',
    hardware: true,
    vendor: 'apple',
    containers: ['mp4', 'mkv'],
    presets: [],
    defaultPreset: '',
    tunes: [],
    profiles: ['auto', 'main', 'main10'],
    quality: { min: 0, max: 100, step: 1, default: 65, label: 'Quality' },
    twoPass: false,
    customParam: null,
    pixelFormats: ['auto', 'yuv420p', 'p010le'],
  },
  {
    id: 'h264_videotoolbox',
    label: 'H.264 / AVC · Apple VideoToolbox',
    short: 'H.264 VideoToolbox',
    family: 'videotoolbox',
    codec: 'h264',
    hardware: true,
    vendor: 'apple',
    containers: ['mp4', 'mkv'],
    presets: [],
    defaultPreset: '',
    tunes: [],
    profiles: ['auto', 'baseline', 'main', 'high'],
    quality: { min: 0, max: 100, step: 1, default: 65, label: 'Quality' },
    twoPass: false,
    customParam: null,
    pixelFormats: ['auto', 'yuv420p'],
  },
];

const AUDIO_CODECS = [
  { id: 'aac', label: 'AAC', containers: ['mp4', 'mkv'], lossy: true, defaultBitrate: 128, merge: true },
  {
    id: 'libopus',
    label: 'Opus',
    containers: ['mkv', 'webm'],
    lossy: true,
    defaultBitrate: 128,
    merge: true,
  },
  {
    id: 'ac3',
    label: 'AC-3',
    containers: ['mp4', 'mkv'],
    lossy: true,
    defaultBitrate: 256,
    merge: true,
  },
  {
    id: 'eac3',
    label: 'E-AC-3',
    containers: ['mp4', 'mkv'],
    lossy: true,
    defaultBitrate: 256,
    merge: true,
  },
  {
    id: 'libmp3lame',
    label: 'MP3',
    containers: ['mp4', 'mkv'],
    lossy: true,
    defaultBitrate: 192,
    merge: true,
  },
  {
    id: 'flac',
    label: 'FLAC (lossless)',
    containers: ['mkv'],
    lossy: false,
    defaultBitrate: 0,
    merge: true,
  },
  {
    id: 'libvorbis',
    label: 'Vorbis',
    containers: ['mkv', 'webm'],
    lossy: true,
    defaultBitrate: 160,
    merge: true,
  },
  {
    id: 'copy',
    label: 'Copia (passthrough)',
    containers: ['mp4', 'mkv'],
    lossy: false,
    defaultBitrate: 0,
    merge: false,
  },
];

const CONTAINERS = [
  { id: 'mp4', label: 'MP4 · maximum compatibility', extension: 'mp4' },
  { id: 'mkv', label: 'MKV · tutte le tracce e formati', extension: 'mkv' },
  { id: 'webm', label: 'WebM · VP9/AV1 + Opus', extension: 'webm' },
];

const HARDWARE_ORDER = [
  'av1_nvenc',
  'av1_qsv',
  'av1_amf',
  'hevc_nvenc',
  'hevc_qsv',
  'hevc_amf',
  'hevc_videotoolbox',
  'h264_nvenc',
  'h264_qsv',
  'h264_amf',
  'h264_videotoolbox',
];

function run(command, args, timeout = 20000, options = {}) {
  return new Promise((resolve) => {
    if (!command) {
      resolve({ code: -1, stdout: '', stderr: 'command not found', error: true });
      return;
    }
    execFile(
      command,
      args,
      {
        timeout,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
        encoding: 'utf8',
        ...options,
      },
      (error, stdout, stderr) => {
        const timedOut = Boolean(error && (error.killed || error.code === 'ETIMEDOUT'));
        resolve({
          code: error ? (typeof error.code === 'number' ? error.code : -1) : 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
          error: Boolean(error),
          timedOut,
        });
      },
    );
  });
}

function vendorFromName(name) {
  const value = String(name || '');
  if (/nvidia|geforce|quadro|rtx|gtx|tesla/i.test(value)) return 'nvidia';
  if (/intel|arc|iris|uhd graphics/i.test(value)) return 'intel';
  if (/amd|radeon|advanced micro|firepro/i.test(value)) return 'amd';
  if (/apple|m[1-4] (max|pro|ultra)?/i.test(value)) return 'apple';
  return 'unknown';
}

function gpuSupports(vendor) {
  if (vendor === 'nvidia') return ['h264_nvenc', 'hevc_nvenc', 'av1_nvenc'];
  if (vendor === 'intel') return ['h264_qsv', 'hevc_qsv', 'av1_qsv'];
  if (vendor === 'amd') return ['h264_amf', 'hevc_amf', 'av1_amf'];
  if (vendor === 'apple') return ['h264_videotoolbox', 'hevc_videotoolbox'];
  return [];
}

function numberFrom(value) {
  const parsed = Number(String(value == null ? '' : value).replace(/[^\d.]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function nvidiaSmi() {
  const root = process.env.SystemRoot || 'C:\\Windows';
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const smi = firstExisting(
    [
      path.join(root, 'System32', 'nvidia-smi.exe'),
      path.join(programFiles, 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe'),
    ],
    'nvidia-smi',
  );
  const result = await run(
    smi,
    ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader,nounits'],
    8000,
  );
  if (result.code !== 0 || !result.stdout.trim()) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, memory, driver] = line.split(',').map((part) => part.trim());
      return {
        name: name || 'NVIDIA GPU',
        vendor: 'nvidia',
        vram: numberFrom(memory) * 1024 * 1024,
        driver: driver || '',
        source: 'nvidia-smi',
      };
    });
}

function firstExisting(candidates, fallback) {
  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }
  return fallback;
}

function windowsTool(name, extraDirs = []) {
  const root = process.env.SystemRoot || 'C:\\Windows';
  const candidates = [
    ...extraDirs.map((dir) => path.join(root, dir, name)),
    path.join(root, 'System32', name),
    name,
  ];
  return firstExisting(candidates, name);
}

async function windowsGpus() {
  const command =
    'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion,VideoProcessor | ConvertTo-Json -Compress';
  const powerShell = windowsTool('powershell.exe', ['System32\\WindowsPowerShell\\v1.0']);
  const result = await run(powerShell, ['-NoProfile', '-NonInteractive', '-Command', command], 20000);
  if (result.code === 0 && result.stdout.trim()) {
    try {
      const parsed = JSON.parse(result.stdout.trim());
      const list = Array.isArray(parsed) ? parsed : [parsed];
      return list
        .filter((entry) => entry && entry.Name)
        .map((entry) => ({
          name: entry.Name,
          vendor: vendorFromName(entry.Name),
          vram: numberFrom(entry.AdapterRAM),
          driver: entry.DriverVersion || '',
          source: 'wmi',
        }));
    } catch {
      /* fall through to wmic */
    }
  }

  const wmicPath = windowsTool('WMIC.exe', ['System32\\wbem']);
  const wmic = await run(
    wmicPath,
    ['path', 'win32_VideoController', 'get', 'Name,AdapterRAM,DriverVersion', '/format:csv'],
    15000,
  );
  if (wmic.code === 0 && wmic.stdout.trim()) {
    return wmic.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !/^Node,/i.test(line))
      .map((line) => {
        const parts = line.split(',');
        const name = parts.slice(1, -2).join(',');
        return {
          name,
          vendor: vendorFromName(name),
          vram: numberFrom(parts[parts.length - 2]),
          driver: parts[parts.length - 1] || '',
          source: 'wmic',
        };
      })
      .filter((gpu) => gpu.name);
  }
  return [];
}

async function macGpus() {
  const result = await run('system_profiler', ['SPDisplaysDataType', '-json'], 20000);
  if (result.code !== 0) return [];
  try {
    const data = JSON.parse(result.stdout);
    const list = data.SPDisplaysDataType || [];
    return list.map((entry) => ({
      name: entry.sppci_model || entry._name || 'Apple GPU',
      vendor: vendorFromName(entry.sppci_model || entry._name || ''),
      vram: numberFrom(entry.spdisplays_vram || entry.spdisplays_vram_shared),
      driver: entry.spdisplays_metal || '',
      source: 'system_profiler',
    }));
  } catch {
    return [];
  }
}

async function linuxGpus() {
  const result = await run('lspci', [], 10000);
  if (result.code !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .filter((line) => /vga|3d|display/i.test(line))
    .map((line) => {
      const name = line.replace(/^[^:]+:\s*/, '').replace(/^.*?controller:\s*/i, '').trim();
      return {
        name,
        vendor: vendorFromName(name),
        vram: 0,
        driver: '',
        source: 'lspci',
      };
    })
    .filter((gpu) => gpu.name);
}

async function detectGpus() {
  let gpus = [];
  if (isWin) {
    const [nvidia, wmi] = await Promise.all([nvidiaSmi(), windowsGpus()]);
    gpus = [...nvidia, ...wmi.filter((gpu) => gpu.vendor !== 'nvidia' || !nvidia.length)];
  } else if (isMac) {
    gpus = await macGpus();
  } else {
    gpus = await linuxGpus();
  }

  const seen = new Set();
  return gpus.filter((gpu) => {
    const key = `${gpu.name}|${gpu.vendor}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function listCompiledEncoders(ffmpegPath) {
  const result = await run(ffmpegPath, ['-hide_banner', '-encoders'], 20000);
  const found = new Set();
  if (result.code !== 0) return found;
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(/^\s*V[.A-Z]{5}\s+(\S+)\s+/);
    if (match) found.add(match[1]);
  }
  return found;
}

function runEncoderTest(ffmpegPath, encoder, extra = []) {
  return new Promise((resolve) => {
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=320x240:r=30',
      '-t',
      '0.3',
      '-c:v',
      encoder,
      ...extra,
      '-f',
      'null',
      '-',
    ];
    let child;
    let stderr = '';
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok, error: ok ? '' : stderr.trim().split(/\r?\n/).slice(-3).join(' ') });
    };
    try {
      child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (error) {
      resolve({ ok: false, error: error.message });
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      finish(false);
    }, 12000);
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 6000) stderr = stderr.slice(-6000);
    });
    child.on('error', (error) => {
      stderr = error.message;
      finish(false);
    });
    child.on('close', (code) => finish(code === 0));
  });
}

async function testHardwareEncoder(ffmpegPath, encoder) {
  let result = await runEncoderTest(ffmpegPath, encoder);
  if (result.ok) return result;
  if (/pixel format|incompatible|not supported|Invalid argument/i.test(result.error)) {
    for (const pixelFormat of ['nv12', 'yuv420p', 'p010le']) {
      result = await runEncoderTest(ffmpegPath, encoder, ['-pix_fmt', pixelFormat]);
      if (result.ok) return result;
    }
  }
  return result;
}

async function scanSystem({ ffmpegPath } = {}) {
  const [gpus, compiled] = await Promise.all([
    detectGpus(),
    ffmpegPath ? listCompiledEncoders(ffmpegPath) : Promise.resolve(new Set()),
  ]);
  const hardwareCatalog = VIDEO_ENCODERS.filter((encoder) => encoder.hardware);
  const candidates = hardwareCatalog.filter((encoder) => compiled.has(encoder.id) || !ffmpegPath);
  const working = [];
  const failed = [];

  for (const encoder of candidates) {
    if (!ffmpegPath) break;
    const result = await testHardwareEncoder(ffmpegPath, encoder.id);
    if (result.ok) working.push(encoder.id);
    else failed.push({ id: encoder.id, error: result.error.slice(0, 260) });
  }

  const ordered = HARDWARE_ORDER.filter((id) => working.includes(id));
  const recommended = ordered[0] || null;
  const vendors = new Set(gpus.map((gpu) => gpu.vendor));

  return {
    platform: process.platform,
    arch: process.arch,
    cpu: os.cpus()[0] ? os.cpus()[0].model : '',
    cpuCores: os.cpus().length,
    totalMemory: os.totalmem(),
    gpus,
    vendors: Array.from(vendors),
    compiled: Array.from(compiled),
    working,
    failed,
    recommended,
    hardwareAvailable: working.length > 0,
    scannedAt: Date.now(),
  };
}

function catalog() {
  return {
    videoEncoders: VIDEO_ENCODERS,
    audioCodecs: AUDIO_CODECS,
    containers: CONTAINERS,
    levels: LEVELS,
  };
}

function encoderById(id) {
  return VIDEO_ENCODERS.find((encoder) => encoder.id === id) || null;
}

module.exports = {
  catalog,
  encoderById,
  scanSystem,
  detectGpus,
  listCompiledEncoders,
  VIDEO_ENCODERS,
  AUDIO_CODECS,
  CONTAINERS,
};
