/* MoliDowloader — Copyright © 2026 Molinays · SPDX-License-Identifier: MIT */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

const isWin = process.platform === 'win32';

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function fixed(value, digits = 3) {
  return Number(value).toFixed(digits);
}

function parseRate(rate) {
  if (!rate || typeof rate !== 'string') return 0;
  const [a, b] = rate.split('/').map(Number);
  if (Number.isFinite(a) && Number.isFinite(b) && b > 0) return a / b;
  return Number.isFinite(a) ? a : 0;
}

function rotationOf(stream) {
  if (!stream) return 0;
  if (Array.isArray(stream.side_data_list)) {
    const found = stream.side_data_list.find((entry) => entry && entry.rotation !== undefined);
    if (found) return num(found.rotation);
  }
  if (stream.tags && stream.tags.rotate !== undefined) return num(stream.tags.rotate);
  return 0;
}

function probe(ffprobePath, filePath) {
  return new Promise((resolve, reject) => {
    if (!ffprobePath) {
      reject(new Error('ffprobe non trovato'));
      return;
    }
    const child = spawn(
      ffprobePath,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
      { windowsHide: true },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `ffprobe ha restituito ${code}`));
        return;
      }
      try {
        const data = JSON.parse(stdout);
        const streams = Array.isArray(data.streams) ? data.streams : [];
        const video = streams.find(
          (stream) =>
            stream.codec_type === 'video' &&
            !(stream.disposition && stream.disposition.attached_pic),
        );
        const audio = streams.find((stream) => stream.codec_type === 'audio');
        const duration =
          num(data.format && data.format.duration) ||
          num(video && video.duration) ||
          num(audio && audio.duration);

        let width = video ? num(video.width) : 0;
        let height = video ? num(video.height) : 0;
        const rotation = Math.abs(rotationOf(video)) % 360;
        if (rotation === 90 || rotation === 270) {
          const swap = width;
          width = height;
          height = swap;
        }

        resolve({
          path: filePath,
          name: path.basename(filePath),
          duration,
          width,
          height,
          fps: video ? parseRate(video.avg_frame_rate || video.r_frame_rate) : 0,
          hasVideo: Boolean(video),
          hasAudio: Boolean(audio),
          videoCodec: video ? video.codec_name || '' : '',
          audioCodec: audio ? audio.codec_name || '' : '',
          audioChannels: audio ? num(audio.channels) : 0,
          audioSampleRate: audio ? num(audio.sample_rate) : 0,
          rotation,
          size: num(data.format && data.format.size),
          format: (data.format && data.format.format_name) || '',
        });
      } catch (error) {
        reject(error);
      }
    });
  });
}

function runBinary(binary, args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    if (!binary) {
      reject(new Error('FFmpeg non trovato'));
      return;
    }
    const child = spawn(binary, args, { windowsHide: true });
    let stderr = '';
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      reject(new Error('Timeout durante l\'elaborazione FFmpeg'));
    }, timeoutMs);

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim().split(/\r?\n/).slice(-4).join(' ') || `FFmpeg ha restituito ${code}`));
    });
  });
}

async function createThumbnail(ffmpegPath, filePath, outputPath, duration) {
  const seek = duration > 2 ? Math.min(1, duration / 10) : 0;
  await runBinary(ffmpegPath, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-ss',
    fixed(seek, 2),
    '-i',
    filePath,
    '-frames:v',
    '1',
    '-vf',
    'scale=320:-2',
    '-q:v',
    '4',
    outputPath,
  ]);
  return fs.existsSync(outputPath);
}

async function createWaveform(ffmpegPath, filePath, outputPath) {
  await runBinary(
    ffmpegPath,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      filePath,
      '-filter_complex',
      'aformat=channel_layouts=mono,showwavespic=s=1400x120:colors=#8a8a8a',
      '-frames:v',
      '1',
      outputPath,
    ],
    300000,
  );
  return fs.existsSync(outputPath);
}

function resolutionFor(project, infos) {
  const preset = project.resolution || 'source';
  if (preset === '1080p') return { width: 1920, height: 1080 };
  if (preset === '720p') return { width: 1280, height: 720 };
  if (preset === 'vertical') return { width: 1080, height: 1920 };
  if (preset === 'square') return { width: 1080, height: 1080 };

  const firstVideo = infos.find((info) => info.hasVideo && info.width > 0 && info.height > 0);
  if (!firstVideo) return { width: 1920, height: 1080 };
  return {
    width: Math.max(2, Math.floor(firstVideo.width / 2) * 2),
    height: Math.max(2, Math.floor(firstVideo.height / 2) * 2),
  };
}

function fpsFor(project, infos) {
  if (String(project.fps) !== 'source') {
    return clamp(num(project.fps, 30) || 30, 1, 120);
  }
  const info = infos.find((item) => item.hasVideo && item.fps > 0);
  return info ? clamp(info.fps, 1, 120) : 30;
}

function killTree(child) {
  if (!child || !child.pid) return;
  if (isWin) {
    try {
      execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    } catch {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }
  } else {
    try {
      child.kill('SIGTERM');
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }, 1500);
    } catch {
      /* ignore */
    }
  }
}

function buildExportPlan({ project, infos, target, fps, audioOnly }) {
  const args = ['-hide_banner', '-loglevel', 'error', '-y'];
  const inputs = [];
  const filters = [];
  const pairs = [];
  let nextInput = 0;
  let totalDuration = 0;

  const normalized = [];

  project.clips.forEach((clip, index) => {
    const info = infos[index];
    if (!info || !info.duration || info.duration <= 0.05) {
      throw new Error(`Clip non valida: ${clip.path}`);
    }
    const start = clamp(num(clip.in, 0), 0, Math.max(0, info.duration - 0.05));
    const end = clamp(num(clip.out, info.duration), start + 0.05, info.duration);
    const speed = clamp(num(clip.speed, 1) || 1, 0.5, 2);
    const sourceDuration = Math.max(0.05, end - start);
    const outputDuration = sourceDuration / speed;
    totalDuration += outputDuration;

    normalized.push({
      ...clip,
      info,
      start,
      end,
      speed,
      outputDuration,
      volume: clamp(num(clip.volume, 1), 0, 2),
      fadeIn: clamp(num(clip.fadeIn, 0), 0, sourceDuration / 2),
      fadeOut: clamp(num(clip.fadeOut, 0), 0, sourceDuration / 2),
    });
  });

  const { width, height } = target;
  const totalFps = fps;

  normalized.forEach((clip, index) => {
    const info = clip.info;
    inputs.push('-i', clip.path);
    const sourceIndex = nextInput++;
    let videoIndex = info.hasVideo ? sourceIndex : -1;
    let audioIndex = info.hasAudio ? sourceIndex : -1;

    if (!audioOnly && videoIndex < 0) {
      inputs.push(
        '-f',
        'lavfi',
        '-t',
        fixed(clip.outputDuration),
        '-i',
        `color=c=black:s=${width}x${height}:r=${fixed(totalFps, 3)}`,
      );
      videoIndex = nextInput++;
    }

    if (audioIndex < 0) {
      inputs.push(
        '-f',
        'lavfi',
        '-t',
        fixed(clip.outputDuration),
        '-i',
        'anullsrc=channel_layout=stereo:sample_rate=48000',
      );
      audioIndex = nextInput++;
    }

    if (!audioOnly) {
      const videoFilters = [];
      if (info.hasVideo) {
        videoFilters.push(`trim=start=${fixed(clip.start)}:end=${fixed(clip.end)}`);
        videoFilters.push(`setpts=(PTS-STARTPTS)/${fixed(clip.speed)}`);
      } else {
        videoFilters.push('setpts=PTS-STARTPTS');
      }
      const fillFrame = ['vertical', 'square'].includes(project.resolution);
      if (fillFrame) {
        videoFilters.push(`scale=${width}:${height}:force_original_aspect_ratio=increase`);
        videoFilters.push(`crop=${width}:${height}`);
      } else {
        videoFilters.push(`scale=${width}:${height}:force_original_aspect_ratio=decrease`);
        videoFilters.push(`pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`);
      }
      videoFilters.push('setsar=1');
      videoFilters.push(`fps=${fixed(totalFps, 3)}`);
      videoFilters.push('format=yuv420p');
      filters.push(`[${videoIndex}:v]${videoFilters.join(',')}[v${index}]`);
    }

    const audioFilters = [];
    if (info.hasAudio) {
      audioFilters.push(`atrim=start=${fixed(clip.start)}:end=${fixed(clip.end)}`);
      audioFilters.push('asetpts=PTS-STARTPTS');
      if (Math.abs(clip.speed - 1) > 0.001) {
        audioFilters.push(`atempo=${fixed(clip.speed)}`);
      }
    } else {
      audioFilters.push(`atrim=0:${fixed(clip.outputDuration)}`);
      audioFilters.push('asetpts=PTS-STARTPTS');
    }
    audioFilters.push(`volume=${fixed(clip.mute ? 0 : clip.volume)}`);
    if (clip.fadeIn > 0.01) {
      audioFilters.push(`afade=t=in:st=0:d=${fixed(clip.fadeIn)}`);
    }
    if (clip.fadeOut > 0.01) {
      audioFilters.push(
        `afade=t=out:st=${fixed(Math.max(0, clip.outputDuration - clip.fadeOut))}:d=${fixed(clip.fadeOut)}`,
      );
    }
    audioFilters.push('aresample=48000');
    audioFilters.push('aformat=sample_fmts=fltp:channel_layouts=stereo');
    filters.push(`[${audioIndex}:a]${audioFilters.join(',')}[a${index}]`);

    pairs.push({ video: `v${index}`, audio: `a${index}` });
  });

  if (!normalized.length) throw new Error('Aggiungi almeno una clip al montaggio');

  if (audioOnly) {
    const labels = pairs.map((pair) => `[${pair.audio}]`).join('');
    filters.push(`${labels}concat=n=${pairs.length}:v=0:a=1[ac]`);
  } else {
    const labels = pairs.map((pair) => `[${pair.video}][${pair.audio}]`).join('');
    filters.push(`${labels}concat=n=${pairs.length}:v=1:a=1[vc][ac]`);
  }

  let audioLabel = 'ac';
  const music = project.music;
  if (music && music.path) {
    if (music.loop) inputs.push('-stream_loop', '-1');
    inputs.push('-i', music.path);
    const musicIndex = nextInput++;
    const musicVolume = clamp(num(music.volume, 0.35), 0, 2);
    const fadeIn = clamp(num(music.fadeIn, 0), 0, totalDuration / 2);
    const fadeOut = clamp(num(music.fadeOut, 0), 0, totalDuration / 2);
    const musicFilters = [
      `atrim=0:${fixed(totalDuration)}`,
      'asetpts=PTS-STARTPTS',
      `volume=${fixed(musicVolume)}`,
    ];
    if (fadeIn > 0.01) musicFilters.push(`afade=t=in:st=0:d=${fixed(fadeIn)}`);
    if (fadeOut > 0.01) {
      musicFilters.push(`afade=t=out:st=${fixed(Math.max(0, totalDuration - fadeOut))}:d=${fixed(fadeOut)}`);
    }
    musicFilters.push('aresample=48000');
    musicFilters.push('aformat=sample_fmts=fltp:channel_layouts=stereo');
    filters.push(`[${musicIndex}:a]${musicFilters.join(',')}[bgm]`);
    filters.push(
      '[ac][bgm]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[aout]',
    );
    audioLabel = 'aout';
  }

  args.push(...inputs,    '-filter_complex', filters.join(';'));

  if (!audioOnly) {
    args.push('-map', '[vc]');
  }
  args.push('-map', `[${audioLabel}]`);
  args.push('-t', fixed(totalDuration));

  const format = project.format === 'mkv' ? 'mkv' : project.format === 'm4a' ? 'm4a' : 'mp4';
  if (audioOnly || format === 'm4a') {
    args.push('-vn', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000');
  } else {
    const crf = clamp(num(project.crf, 20) || 20, 12, 35);
    const preset = ['ultrafast', 'veryfast', 'fast', 'medium', 'slow'].includes(project.preset)
      ? project.preset
      : 'medium';
    args.push(
      '-c:v',
      'libx264',
      '-preset',
      preset,
      '-crf',
      String(crf),
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-ar',
      '48000',
    );
    if (format === 'mp4') args.push('-movflags', '+faststart');
  }

  args.push('-progress', 'pipe:1', '-stats_period', '0.25', '-nostats');

  return { args, totalDuration, normalized, target, fps: totalFps, format };
}

function exportMontage({ ffmpegPath, ffprobePath, project, outputPath, onProgress }) {
  let child = null;
  let cancelled = false;

  const promise = (async () => {
    if (!ffmpegPath) throw new Error('FFmpeg non trovato');
    if (!project || !Array.isArray(project.clips) || !project.clips.length) {
      throw new Error('Aggiungi almeno una clip al montaggio');
    }
    if (!outputPath) throw new Error('Scegli un file di output');

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const infos = [];
    for (const clip of project.clips) {
      if (!clip.path || !fs.existsSync(clip.path)) {
        throw new Error(`File non trovato: ${clip.path || '(vuoto)'}`);
      }
      infos.push(await probe(ffprobePath, clip.path));
    }

    let music = null;
    if (project.music && project.music.path) {
      if (!fs.existsSync(project.music.path)) throw new Error('Traccia musicale non trovata');
      const musicInfo = await probe(ffprobePath, project.music.path);
      if (!musicInfo.hasAudio) throw new Error('La traccia musicale non contiene audio');
      music = { ...project.music, duration: musicInfo.duration };
    }

    const audioOnly = project.format === 'm4a';
    const target = audioOnly ? { width: 0, height: 0 } : resolutionFor(project, infos);
    const fps = fpsFor(project, infos);
    const plan = buildExportPlan({
      project: { ...project, music },
      infos,
      target,
      fps,
      audioOnly,
    });

    if (!audioOnly) {
      const { width, height } = plan.target;
      if (width < 2 || height < 2) throw new Error('Risoluzione di output non valida');
    }

    const args = [...plan.args, outputPath];
    const stderrChunks = [];

    const exitCode = await new Promise((resolve, reject) => {
      child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdoutBuffer = '';

      child.stdout.on('data', (chunk) => {
        stdoutBuffer += chunk.toString();
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() || '';
        for (const line of lines) {
          const match = line.match(/^out_time_(?:us|ms)=(\d+)/);
          if (match) {
            const seconds = Number(match[1]) / 1e6;
            const progress = Math.max(0, Math.min(0.995, seconds / plan.totalDuration));
            if (onProgress) onProgress({ progress, seconds, total: plan.totalDuration });
          }
        }
      });

      child.stderr.on('data', (chunk) => {
        stderrChunks.push(chunk.toString());
        if (stderrChunks.length > 60) stderrChunks.shift();
      });
      child.on('error', reject);
      child.on('close', (code) => resolve(code));
    });

    if (cancelled) {
      throw new Error('Esportazione annullata');
    }
    if (exitCode !== 0) {
      const details = stderrChunks.join('').trim().split(/\r?\n/).slice(-5).join(' ');
      throw new Error(details || `FFmpeg ha restituito ${exitCode}`);
    }

    let stat;
    try {
      stat = fs.statSync(outputPath);
    } catch {
      throw new Error('FFmpeg non ha prodotto il file di output');
    }
    if (!stat.size) throw new Error('Il file esportato è vuoto');

    if (onProgress) onProgress({ progress: 1, seconds: plan.totalDuration, total: plan.totalDuration });
    return {
      path: outputPath,
      size: stat.size,
      duration: plan.totalDuration,
      format: plan.format,
      target: plan.target,
      fps: plan.fps,
    };
  })();

  promise.cancel = () => {
    cancelled = true;
    killTree(child);
  };

  promise.catch(() => {
    try {
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    } catch {
      /* ignore */
    }
  });

  return promise;
}

module.exports = {
  probe,
  createThumbnail,
  createWaveform,
  buildExportPlan,
  exportMontage,
  resolutionFor,
  fpsFor,
  parseRate,
};
