/* MoliDowloader — Copyright © 2026 Molinays · SPDX-License-Identifier: MIT */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');

const isWin = process.platform === 'win32';
const DEV_NULL = isWin ? 'NUL' : '/dev/null';

const TEXT_SUBTITLE_CODECS = new Set([
  'subrip',
  'ass',
  'ssa',
  'mov_text',
  'webvtt',
  'text',
  'subviewer',
  'subviewer1',
  'microdvd',
  'sami',
  'realtext',
  'eia_608',
  'hdmv_text_subtitle',
]);

const AUDIO_CODEC_IDS = new Set([
  'aac',
  'libopus',
  'ac3',
  'eac3',
  'libmp3lame',
  'flac',
  'libvorbis',
  'copy',
]);

const VIDEO_ENCODER_IDS = new Set([
  'libx265',
  'libx264',
  'libaom-av1',
  'libvpx-vp9',
  'hevc_nvenc',
  'h264_nvenc',
  'av1_nvenc',
  'hevc_qsv',
  'h264_qsv',
  'av1_qsv',
  'hevc_amf',
  'h264_amf',
  'av1_amf',
  'hevc_videotoolbox',
  'h264_videotoolbox',
]);

const SOFTWARE_ENCODERS = new Set(['libx264', 'libx265', 'libaom-av1', 'libvpx-vp9']);

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

function safeInt(value, min, max, fallback = 0) {
  const parsed = Math.round(num(value, fallback));
  if (!Number.isFinite(parsed)) return fallback;
  return clamp(parsed, min, max);
}

function safeString(value, maxLength = 400) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, maxLength);
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

function languageOf(stream) {
  return (stream && stream.tags && (stream.tags.language || stream.tags.LANGUAGE)) || '';
}

function titleOf(stream) {
  return (stream && stream.tags && (stream.tags.title || stream.tags.TITLE)) || '';
}

function isDefault(stream) {
  return Boolean(stream && stream.disposition && stream.disposition.default);
}

function isForced(stream) {
  return Boolean(stream && stream.disposition && stream.disposition.forced);
}

function probeSource(ffprobePath, filePath) {
  return new Promise((resolve, reject) => {
    if (!ffprobePath) {
      reject(new Error('ffprobe non trovato'));
      return;
    }
    if (!filePath || !fs.existsSync(filePath)) {
      reject(new Error(`File non trovato: ${filePath || '(vuoto)'}`));
      return;
    }
    const child = spawn(
      ffprobePath,
      [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        '-show_chapters',
        filePath,
      ],
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
        const format = data.format || {};
        const chapters = Array.isArray(data.chapters) ? data.chapters : [];
        const videoTracks = [];
        const audioTracks = [];
        const subtitleTracks = [];
        let attachmentCount = 0;
        let audioIndex = 0;
        let subtitleIndex = 0;

        for (const stream of streams) {
          if (stream.codec_type === 'video' && !(stream.disposition && stream.disposition.attached_pic)) {
            let width = num(stream.width);
            let height = num(stream.height);
            const rotation = Math.abs(rotationOf(stream)) % 360;
            if (rotation === 90 || rotation === 270) {
              const swap = width;
              width = height;
              height = swap;
            }
            videoTracks.push({
              index: stream.index,
              order: videoTracks.length,
              codec: stream.codec_name || '',
              codecLong: stream.codec_long_name || '',
              width,
              height,
              fps: parseRate(stream.avg_frame_rate || stream.r_frame_rate),
              bitrate: num(stream.bit_rate),
              pixFmt: stream.pix_fmt || '',
              language: languageOf(stream),
              title: titleOf(stream),
              default: isDefault(stream),
              rotation,
            });
          } else if (stream.codec_type === 'audio') {
            audioTracks.push({
              index: stream.index,
              order: audioIndex,
              codec: stream.codec_name || '',
              codecLong: stream.codec_long_name || '',
              channels: num(stream.channels),
              channelLayout: stream.channel_layout || '',
              sampleRate: num(stream.sample_rate),
              bitrate: num(stream.bit_rate),
              language: languageOf(stream),
              title: titleOf(stream),
              default: isDefault(stream),
            });
            audioIndex += 1;
          } else if (stream.codec_type === 'subtitle') {
            subtitleTracks.push({
              index: stream.index,
              order: subtitleIndex,
              codec: stream.codec_name || '',
              codecLong: stream.codec_long_name || '',
              language: languageOf(stream),
              title: titleOf(stream),
              default: isDefault(stream),
              forced: isForced(stream),
              text: TEXT_SUBTITLE_CODECS.has(stream.codec_name || ''),
            });
            subtitleIndex += 1;
          } else if (stream.codec_type === 'attachment') {
            attachmentCount += 1;
          }
        }

        const duration =
          num(format.duration) ||
          num(videoTracks[0] && format.duration) ||
          num(videoTracks[0] && videoTracks[0].duration) ||
          num(audioTracks[0] && audioTracks[0].duration);

        resolve({
          path: filePath,
          name: path.basename(filePath),
          size: num(format.size),
          duration,
          bitrate: num(format.bit_rate),
          format: format.format_name || '',
          formatLong: format.format_long_name || '',
          videoTracks,
          audioTracks,
          subtitleTracks,
          attachmentCount,
          chapterCount: chapters.length,
          hasVideo: videoTracks.length > 0,
          hasAudio: audioTracks.length > 0,
          hasSubtitles: subtitleTracks.length > 0,
        });
      } catch (error) {
        reject(error);
      }
    });
  });
}

function containerOf(options) {
  const container = String((options && options.container) || 'mp4').toLowerCase();
  return ['mp4', 'mkv', 'webm'].includes(container) ? container : 'mp4';
}

function containerExtension(container) {
  return container === 'mkv' ? 'mkv' : container === 'webm' ? 'webm' : 'mp4';
}

function videoEncoderSupported(encoder, container) {
  if (container === 'webm') {
    return ['libvpx-vp9', 'libaom-av1', 'av1_nvenc', 'av1_qsv', 'av1_amf'].includes(encoder);
  }
  if (container === 'mp4') {
    return !['libvpx-vp9'].includes(encoder);
  }
  return true;
}

function audioCodecSupported(codec, container) {
  if (!AUDIO_CODEC_IDS.has(codec)) return false;
  if (container === 'webm') return ['libopus', 'libvorbis'].includes(codec);
  if (container === 'mp4') return ['aac', 'ac3', 'eac3', 'libmp3lame', 'copy'].includes(codec);
  return true;
}

function subtitleTarget(container, track) {
  if (!track) return null;
  if (container === 'mkv') return 'copy';
  if (!track.text) return null;
  if (container === 'mp4') return 'mov_text';
  if (container === 'webm') return 'webvtt';
  return null;
}

function resolveScale(source, options) {
  const video = source.videoTracks[0];
  if (!video || !video.width || !video.height) return null;
  const resolution = String(options.resolution || 'source');
  if (resolution === 'source') return null;
  const noUpscale = options.noUpscale !== false;

  if (resolution === 'custom') {
    let width = safeInt(options.width, 0, 16384, 0);
    let height = safeInt(options.height, 0, 16384, 0);
    if (width > 0) width = Math.floor(width / 2) * 2;
    if (height > 0) height = Math.floor(height / 2) * 2;
    if (width <= 0 && height <= 0) return null;
    if (noUpscale) {
      const targetWidth = width > 0 ? width : Math.round((video.width * height) / video.height);
      const targetHeight = height > 0 ? height : Math.round((video.height * width) / video.width);
      if (targetWidth >= video.width && targetHeight >= video.height) return null;
    }
    if (width > 0 && height > 0) {
      return `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,scale=trunc(iw/2)*2:trunc(ih/2)*2`;
    }
    if (width > 0) return `scale=${width}:-2:flags=lanczos`;
    return `scale=-2:${height}:flags=lanczos`;
  }

  const heights = { '2160p': 2160, '1440p': 1440, '1080p': 1080, '720p': 720, '480p': 480, '360p': 360 };
  const targetHeight = heights[resolution];
  if (!targetHeight) return null;
  if (noUpscale && video.height <= targetHeight) return null;
  return `scale=-2:${targetHeight}:flags=lanczos`;
}

function escapeFilterValue(value) {
  return String(value)
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function burnSubtitleFilter(sourcePath, track) {
  if (!track) return '';
  return `subtitles='${escapeFilterValue(sourcePath)}':si=${Math.max(0, Number(track.order) || 0)}`;
}

function buildVideoFilters(source, options, burnTrack) {
  const filters = [];
  const crop = options.crop || {};
  const top = safeInt(crop.top, 0, 10000, 0);
  const bottom = safeInt(crop.bottom, 0, 10000, 0);
  const left = safeInt(crop.left, 0, 10000, 0);
  const right = safeInt(crop.right, 0, 10000, 0);
  if (top || bottom || left || right) {
    const video = source.videoTracks[0] || {};
    if (video.width && left + right >= video.width) throw new Error('Crop orizzontale troppo grande per questo video');
    if (video.height && top + bottom >= video.height) throw new Error('Crop verticale troppo grande per questo video');
    filters.push(`crop=iw-${left + right}:ih-${top + bottom}:${left}:${top}`);
    filters.push('scale=trunc(iw/2)*2:trunc(ih/2)*2');
  }

  if (options.deinterlace === 'force') filters.push('yadif=mode=send_frame:deint=all');
  else if (options.deinterlace === 'auto') filters.push('yadif=mode=send_frame:deint=interlaced');

  const denoise = String(options.denoise || 'off');
  if (denoise === 'light') filters.push('hqdn3d=2:1.5:3:2.25');
  else if (denoise === 'medium') filters.push('hqdn3d=4:3:6:4.5');
  else if (denoise === 'strong') filters.push('hqdn3d=8:6:12:9');

  const scale = resolveScale(source, options);
  if (scale) filters.push(scale);

  if (String(options.fps || 'source') !== 'source') {
    const fps = safeInt(options.fps, 1, 240, 30);
    filters.push(`fps=${fixed(fps, 3)}`);
  }

  if (options.sharpen === 'light') filters.push('unsharp=5:5:0.8:5:5:0.0');
  else if (options.sharpen === 'strong') filters.push('unsharp=5:5:1.2:5:5:0.0');

  // I sottotitoli si bruciano dopo il ridimensionamento, così la dimensione
  // del testo resta coerente con l'output.
  if (burnTrack) filters.push(burnSubtitleFilter(source.path, burnTrack));

  return filters.join(',');
}

function addRateControl(args, encoder, options) {
  const mode = ['quality', 'bitrate', 'cbr', 'twopass'].includes(options.qualityMode)
    ? options.qualityMode
    : 'quality';
  const quality = safeInt(options.quality, 0, 63, 24);
  const bitrate = safeInt(options.bitrate, 0, 1000000, 0);
  const maxrate = safeInt(options.maxrate, 0, 2000000, 0);
  const bufsize = safeInt(options.bufsize, 0, 2000000, 0);
  const family = encoder.family;

  if (mode === 'quality') {
    if (family === 'x264' || family === 'x265') {
      args.push('-crf', String(quality));
    } else if (family === 'aom' || family === 'vp9') {
      args.push('-crf', String(quality), '-b:v', '0');
    } else if (family === 'nvenc') {
      args.push('-rc', 'vbr', '-cq', String(quality), '-b:v', '0');
      if (options.nvencAq !== false) args.push('-spatial-aq', '1', '-temporal-aq', '1');
    } else if (family === 'qsv') {
      args.push('-global_quality', String(quality));
    } else if (family === 'amf') {
      args.push('-rc', 'cqp', '-qp_i', String(quality), '-qp_p', String(quality));
      if (encoder.codec === 'h264') args.push('-qp_b', String(quality));
    } else if (family === 'videotoolbox') {
      args.push('-q:v', String(quality), '-b:v', '0');
    }
    return mode;
  }

  if (!bitrate) throw new Error('Inserisci un bitrate video valido');
  const rate = `${bitrate}k`;
  const max = maxrate ? `${maxrate}k` : '';
  const buffer = bufsize ? `${bufsize}k` : '';

  if (family === 'nvenc') {
    args.push('-rc', mode === 'cbr' ? 'cbr' : 'vbr', '-b:v', rate);
    if (max) args.push('-maxrate', max);
    if (buffer) args.push('-bufsize', buffer);
    if (mode === 'quality') args.push('-cq', String(quality));
    if (mode !== 'cbr' && options.nvencAq !== false) args.push('-spatial-aq', '1', '-temporal-aq', '1');
  } else if (family === 'amf') {
    args.push('-rc', mode === 'cbr' ? 'cbr' : 'vbr_peak', '-b:v', rate);
    if (max) args.push('-maxrate', max);
    if (buffer) args.push('-bufsize', buffer);
  } else if (family === 'qsv') {
    args.push('-b:v', rate);
    if (max) args.push('-maxrate', max);
    if (buffer) args.push('-bufsize', buffer);
    if (mode === 'cbr') args.push('-minrate', rate);
  } else if (family === 'videotoolbox') {
    args.push('-b:v', rate);
    if (max) args.push('-maxrate', max);
    if (buffer) args.push('-bufsize', buffer);
  } else {
    args.push('-b:v', rate);
    if (max) args.push('-maxrate', max);
    if (buffer) args.push('-bufsize', buffer);
  }

  if (mode === 'twopass' && !encoder.twoPass) {
    throw new Error('Questo encoder non supporta il 2-pass');
  }
  return mode;
}

function resolvePixelFormat(encoder, videoTrack, requested) {
  const value = String(requested || 'auto');
  if (value !== 'auto') return value;
  if (!videoTrack || !/10|12|16/.test(String(videoTrack.pixFmt || ''))) return 'auto';
  if (encoder.codec === 'h264') return 'yuv420p';
  if (encoder.hardware) return 'p010le';
  return 'yuv420p10le';
}

function buildVideoArgs(encoderId, options) {
  if (!VIDEO_ENCODER_IDS.has(encoderId)) throw new Error(`Encoder video non valido: ${encoderId}`);
  const encoder = require('./hardware').encoderById(encoderId);
  if (!encoder) throw new Error(`Encoder video non supportato: ${encoderId}`);

  const args = ['-c:v', encoderId];
  let preset = safeString(options.preset, 32);
  if (preset && !encoder.presets.some((item) => item.value === preset)) {
    preset = encoder.defaultPreset || '';
  }
  if (preset) {
    if (encoder.family === 'aom' || encoder.family === 'vp9') {
      args.push('-cpu-used', preset);
    } else if (encoder.family === 'amf') {
      args.push('-quality', preset);
    } else {
      args.push('-preset', preset);
    }
  }

  const tune = safeString(options.tune, 32);
  if (tune && encoder.tunes.includes(tune)) args.push('-tune', tune);

  if (encoder.family === 'vp9') args.push('-deadline', 'good', '-row-mt', '1');
  if (encoder.family === 'aom') args.push('-row-mt', '1');

  const profile = safeString(options.profile, 32) || 'auto';
  if (profile !== 'auto' && encoder.profiles.includes(profile)) args.push('-profile:v', profile);
  const level = safeString(options.level, 16) || 'auto';
  const levels = require('./hardware').catalog().levels;
  if (level !== 'auto' && levels.includes(level)) args.push('-level', level);

  const pixelFormat = safeString(options.pixFmt, 32) || 'auto';
  if (pixelFormat !== 'auto' && (encoder.pixelFormats || []).includes(pixelFormat)) {
    args.push('-pix_fmt', pixelFormat);
  }

  const keyint = safeInt(options.keyint, 0, 3600, 0);
  if (keyint > 0) args.push('-g', String(keyint));

  if (encoder.family === 'x264' || encoder.family === 'x265') {
    const bframes = safeInt(options.bframes, 0, 16, 0);
    const refs = safeInt(options.refs, 0, 16, 0);
    if (bframes > 0) args.push('-bf', String(bframes));
    if (refs > 0) args.push('-refs', String(refs));
    const custom = safeString(options.custom, 2000);
    if (custom && encoder.customParam) args.push(`-${encoder.customParam}`, custom);
  }

  const mode = addRateControl(args, encoder, { ...options, qualityMode: options.qualityMode });
  return { args, encoder, mode };
}

function buildAudioSelection(source, options, container) {
  const selected = Array.isArray(options.audioTracks)
    ? options.audioTracks.map((value) => Number(value)).filter((value) => Number.isFinite(value))
    : source.audioTracks.map((track) => track.index);
  const byIndex = new Map(source.audioTracks.map((track) => [track.index, track]));
  const tracks = selected.map((index) => byIndex.get(index)).filter(Boolean);
  const merge = Boolean(options.mergeAudio);
  let codec = String(options.audioCodec || (merge ? 'aac' : 'copy'));

  if (!tracks.length) return { tracks: [], merge: false, codec: 'copy', warnings: [] };
  if (merge && codec === 'copy') codec = 'aac';
  if (!audioCodecSupported(codec, container)) {
    throw new Error(`Il codec audio "${codec}" non è compatibile con ${container.toUpperCase()}`);
  }
  if (merge && !['aac', 'libopus', 'ac3', 'eac3', 'libmp3lame', 'flac', 'libvorbis'].includes(codec)) {
    throw new Error('Per unire le tracce audio scegli un codec di codifica, non "Copia"');
  }

  let loudnorm = Boolean(options.audioLoudnorm);
  if (loudnorm && codec === 'copy') {
    // loudnorm è un filtro: serve ricodificare, non si può copiare il flusso.
    codec = container === 'webm' ? 'libopus' : 'aac';
  }
  if (loudnorm && !merge && tracks.length > 1) {
    loudnorm = false;
    warnings.push('Normalizzazione volume saltata: con più tracce audio attiva “Unisci le tracce”.');
  }

  const bitrate = safeInt(options.audioBitrate, 8, 1024, 128);
  if (codec !== 'copy' && codec !== 'flac' && !bitrate) {
    throw new Error('Inserisci un bitrate audio valido');
  }

  const warnings = [];
  if (codec === 'copy' && container === 'mp4') {
    const incompatible = tracks.filter(
      (track) => !['aac', 'ac3', 'eac3', 'mp3', 'alac'].includes(track.codec),
    );
    if (incompatible.length) {
      warnings.push(
        `Alcune tracce audio (${incompatible.map((track) => track.codec).join(', ')}) potrebbero non essere compatibili con MP4 in modalità copia.`,
      );
    }
  }

  const gains = {};
  const rawGains = options.audioGains && typeof options.audioGains === 'object' ? options.audioGains : {};
  for (const track of tracks) {
    const value = num(rawGains[track.index], 1);
    gains[track.index] = clamp(value, 0, 2);
  }

  return { tracks, merge, codec, bitrate, gains, loudnorm, warnings };
}

function channelsValue(options) {
  const value = String(options.audioChannels || 'source');
  if (value === 'mono') return 1;
  if (value === 'stereo') return 2;
  if (value === '5.1') return 6;
  return 0;
}

function buildAudioArgs(selection, options) {
  if (!selection.tracks.length) return ['-an'];
  if (selection.codec === 'copy') return ['-c:a', 'copy'];
  const args = ['-c:a', selection.codec];
  if (selection.codec !== 'flac' && selection.bitrate > 0) args.push('-b:a', `${selection.bitrate}k`);
  const channels = channelsValue(options);
  if (channels > 0) args.push('-ac', String(channels));
  const sampleRate = safeInt(options.audioSampleRate, 8000, 192000, 0);
  if (sampleRate >= 8000) args.push('-ar', String(sampleRate));
  return args;
}

function audioOutputMetadataArgs(selection, source, options) {
  const args = [];
  if (!selection.tracks.length) return args;
  if (selection.merge) {
    args.push('-metadata:s:a:0', 'title=Traccia audio mixata');
    return args;
  }
  selection.tracks.forEach((track, index) => {
    if (track.language) args.push(`-metadata:s:a:${index}`, `language=${track.language}`);
    if (track.title) args.push(`-metadata:s:a:${index}`, `title=${track.title}`);
  });
  return args;
}

function buildSubtitleSelection(source, options, container) {
  const selected = Array.isArray(options.subtitleTracks)
    ? options.subtitleTracks.map((value) => Number(value)).filter((value) => Number.isFinite(value))
    : source.subtitleTracks.map((track) => track.index);
  const byIndex = new Map(source.subtitleTracks.map((track) => [track.index, track]));
  const tracks = [];
  const warnings = [];
  let target = null;

  for (const index of selected) {
    const track = byIndex.get(index);
    if (!track) continue;
    const codec = subtitleTarget(container, track);
    if (!codec) {
      warnings.push(
        `Sottotitoli ${track.language || track.codec} non compatibili con ${container.toUpperCase()} (${track.codec}) e verranno saltati.`,
      );
      continue;
    }
    target = codec;
    tracks.push(track);
  }

  return { tracks, target, warnings };
}

function buildSubtitleArgs(selection) {
  if (!selection.tracks.length) return [];
  const args = [];
  for (const track of selection.tracks) args.push('-map', `0:${track.index}`);
  args.push('-c:s', selection.target);
  selection.tracks.forEach((track, index) => {
    if (track.language) args.push(`-metadata:s:s:${index}`, `language=${track.language}`);
    if (track.title) args.push(`-metadata:s:s:${index}`, `title=${track.title}`);
  });
  return args;
}

function estimatePlan(source, options, selection, encoder) {
  if (options.qualityMode === 'quality') return null;
  const videoBitrate = Math.max(0, Math.round(num(options.bitrate)));
  if (!videoBitrate || !source.duration) return null;
  const audioBitrate = selection.tracks.length
    ? (selection.merge ? 1 : selection.tracks.length) *
      (selection.codec === 'copy' ? 0 : Math.max(0, Math.round(num(options.audioBitrate, 128))))
    : 0;
  const bits = (videoBitrate + audioBitrate) * 1000 * source.duration;
  if (!bits) return null;
  return Math.round((bits / 8) * 1.02);
}

function buildCompressPlan({ source, options, outputPath }) {
  if (!source || !source.videoTracks || !source.videoTracks.length) {
    throw new Error('Il file non contiene una traccia video');
  }
  if (typeof outputPath !== 'string' || !outputPath || outputPath.includes('\u0000')) {
    throw new Error('Scegli un file di output valido');
  }

  const container = containerOf(options);
  const encoderId = String(options.videoEncoder || 'libx265');
  if (!videoEncoderSupported(encoderId, container)) {
    throw new Error(`L'encoder ${encoderId} non è compatibile con ${container.toUpperCase()}`);
  }

  const videoTrackIndex = Number.isFinite(Number(options.videoTrack))
    ? Number(options.videoTrack)
    : source.videoTracks[0].index;
  const videoTrack = source.videoTracks.find((track) => track.index === videoTrackIndex);
  if (!videoTrack) throw new Error('Traccia video non trovata');

  const totalDuration = Math.max(0, num(source.duration));
  const rangeStart = clamp(num(options.startTime), 0, Math.max(0, totalDuration - 0.1));
  const rangeEndRaw = num(options.endTime);
  const rangeEnd =
    rangeEndRaw > 0 ? clamp(rangeEndRaw, rangeStart + 0.1, totalDuration || rangeEndRaw) : totalDuration;
  const duration = Math.max(0.1, rangeEnd > rangeStart ? rangeEnd - rangeStart : totalDuration || 0.1);
  const useRange = rangeStart > 0.001 || duration < totalDuration - 0.001;

  const selectedOptions = {
    ...options,
    container,
    qualityMode: ['quality', 'bitrate', 'cbr', 'twopass', 'target'].includes(options.qualityMode)
      ? options.qualityMode
      : 'quality',
  };
  if (selectedOptions.qualityMode === 'twopass' && !SOFTWARE_ENCODERS.has(encoderId)) {
    selectedOptions.qualityMode = 'bitrate';
  }
  const encoderMeta = require('./hardware').encoderById(encoderId) || { codec: 'h264', hardware: false };
  selectedOptions.pixFmt = resolvePixelFormat(encoderMeta, videoTrack, selectedOptions.pixFmt);

  const warnings = [];
  const audio = buildAudioSelection(source, selectedOptions, container);
  warnings.push(...audio.warnings);

  const burnIndex = selectedOptions.burnSubtitles ? Number(selectedOptions.burnSubtitleTrack) : NaN;
  const burnTrack = Number.isFinite(burnIndex)
    ? source.subtitleTracks.find((track) => track.index === burnIndex && track.text) || null
    : null;
  if (selectedOptions.burnSubtitles && !burnTrack) {
    warnings.push('Sottotitoli da bruciare non trovati: nessuna traccia testuale selezionata.');
  }

  const subtitleOptions = {
    ...selectedOptions,
    subtitleTracks: (Array.isArray(selectedOptions.subtitleTracks)
      ? selectedOptions.subtitleTracks
      : source.subtitleTracks.map((track) => track.index)
    ).filter((index) => !burnTrack || Number(index) !== burnTrack.index),
  };
  const subtitles = buildSubtitleSelection(source, subtitleOptions, container);
  warnings.push(...subtitles.warnings);

  if (selectedOptions.qualityMode === 'target') {
    const targetMB = clamp(num(selectedOptions.targetSizeMB, 0), 1, 1024 * 1024);
    const audioKbps = audio.tracks.length
      ? (audio.merge ? 1 : audio.tracks.length) *
        (audio.codec === 'copy'
          ? Math.round(
              audio.tracks.reduce((sum, track) => sum + (num(track.bitrate) || 160000), 0) /
                1000 /
                (audio.merge ? audio.tracks.length : 1),
            )
          : audio.codec === 'flac'
            ? 700
            : Math.max(8, num(selectedOptions.audioBitrate, 128)))
      : 0;
    const totalKbps = (targetMB * 8 * 1024) / duration;
    selectedOptions.bitrate = Math.max(50, Math.round(totalKbps - audioKbps));
    // A due passate il bitrate viene centrato sul target; gli encoder hardware
    // lavorano in una sola passata e restano più approssimativi.
    selectedOptions.qualityMode = encoderMeta && encoderMeta.twoPass ? 'twopass' : 'bitrate';
  }

  const videoFilters = buildVideoFilters(source, selectedOptions, burnTrack);
  const { args: videoArgs, encoder } = buildVideoArgs(encoderId, selectedOptions);

  // Il filtro subtitles rilegge il file con i timestamp originali: con un
  // taglio serve la ricerca sull'output, altrimenti i sottotitoli slittano.
  const seekArgs = burnTrack && rangeStart > 0.001 ? [] : rangeStart > 0.001 ? ['-ss', fixed(rangeStart, 3)] : [];
  const trimArgs = useRange ? ['-t', fixed(duration, 3)] : [];
  const afterInputArgs = [];
  if (burnTrack && rangeStart > 0.001) afterInputArgs.push('-ss', fixed(rangeStart, 3));
  afterInputArgs.push(...trimArgs);

  const useHwAccel = selectedOptions.hwaccel !== false && Boolean(encoder.hardware);
  // Con NVENC e nessun filtro video le frame restano sulla GPU (CUDA): evita il
  // download in RAM e su 4K è più veloce. Con i filtri serve il percorso "auto",
  // che riporta le frame in memoria per i filtri software.
  const cudaFastPath = useHwAccel && encoder.family === 'nvenc' && !videoFilters;
  if (cudaFastPath) {
    // Con frame CUDA non va forzato -pix_fmt: FFmpeg inserirebbe un auto_scale
    // impossibile tra il formato hardware e quello richiesto. NVENC sceglie
    // p010/yuv420p in base alla sorgente.
    const pixFmtIndex = videoArgs.indexOf('-pix_fmt');
    if (pixFmtIndex >= 0) videoArgs.splice(pixFmtIndex, 2);
  }
  const finalArgs = [
    '-hide_banner',
    '-loglevel',
    'warning',
    '-y',
    ...(useHwAccel
      ? cudaFastPath
        ? ['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda']
        : ['-hwaccel', 'auto']
      : []),
    ...seekArgs,
    '-i',
    source.path,
    ...afterInputArgs,
    '-progress',
    'pipe:1',
    '-stats_period',
    '0.25',
    '-nostats',
  ];

  let filterComplex = '';
  if (audio.merge && audio.tracks.length) {
    const chains = [];
    if (videoFilters) {
      chains.push(`[0:${videoTrack.index}]${videoFilters}[vout]`);
    }
    audio.tracks.forEach((track, index) => {
      const gain = audio.gains[track.index] == null ? 1 : audio.gains[track.index];
      const channels = channelsValue(selectedOptions);
      const layout = channels === 1 ? 'mono' : channels === 6 ? '5.1' : 'stereo';
      chains.push(
        `[0:${track.index}]volume=${fixed(gain)},aresample=48000:async=1:first_pts=0,aformat=sample_fmts=fltp:channel_layouts=${layout}[a${index}]`,
      );
    });
    const labels = audio.tracks.map((_, index) => `[a${index}]`).join('');
    chains.push(
      `${labels}amix=inputs=${audio.tracks.length}:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95${audio.loudnorm ? ',loudnorm=I=-16:TP=-1.5:LRA=11' : ''}[aout]`,
    );
    filterComplex = chains.join(';');
    finalArgs.push('-filter_complex', filterComplex);
    finalArgs.push('-map', videoFilters ? '[vout]' : `0:${videoTrack.index}`);
    finalArgs.push('-map', '[aout]');
  } else {
    if (videoFilters) finalArgs.push('-vf', videoFilters);
    finalArgs.push('-map', `0:${videoTrack.index}`);
    for (const track of audio.tracks) finalArgs.push('-map', `0:${track.index}`);
    if (audio.loudnorm && audio.tracks.length === 1) {
      finalArgs.push('-af', 'loudnorm=I=-16:TP=-1.5:LRA=11');
    }
  }

  finalArgs.push(...videoArgs);
  if (encoder.codec === 'hevc' && container === 'mp4') finalArgs.push('-tag:v', 'hvc1');

  if (!audio.tracks.length) {
    finalArgs.push('-an');
  } else {
    finalArgs.push(...buildAudioArgs(audio, selectedOptions));
    finalArgs.push(...audioOutputMetadataArgs(audio, source, selectedOptions));
  }

  const subtitleArgs = buildSubtitleArgs(subtitles);
  if (subtitleArgs.length) finalArgs.push(...subtitleArgs);
  else finalArgs.push('-sn');

  const keepAttachments = selectedOptions.keepAttachments !== false && container === 'mkv';
  if (keepAttachments && source.attachmentCount > 0) {
    finalArgs.push('-map', '0:t?', '-c:t', 'copy');
  }

  if (selectedOptions.keepChapters === false) finalArgs.push('-map_chapters', '-1');
  else if (source.chapterCount > 0) finalArgs.push('-map_chapters', '0');

  if (selectedOptions.keepMetadata === false) finalArgs.push('-map_metadata', '-1');
  else finalArgs.push('-map_metadata', '0');

  if (container === 'mp4' && selectedOptions.faststart !== false) {
    finalArgs.push('-movflags', '+faststart');
  }

  const estimate = estimatePlan({ ...source, duration }, selectedOptions, audio, encoder);
  finalArgs.push(outputPath);

  return {
    args: finalArgs,
    videoArgs,
    videoFilter: videoFilters,
    videoIndex: videoTrack.index,
    videoTrack,
    encoder,
    encoderId,
    container,
    extension: containerExtension(container),
    audio,
    subtitles,
    warnings,
    estimate,
    duration,
    startSeconds: burnTrack && rangeStart > 0.001 ? rangeStart : 0,
    rangeStart,
    rangeEnd,
    seekArgs,
    trimArgs,
    afterInputArgs,
    burned: Boolean(burnTrack),
    loudnorm: audio.loudnorm,
    filterComplex,
    qualityMode: selectedOptions.qualityMode,
    hwaccel: useHwAccel,
    hwaccelMode: cudaFastPath ? 'cuda' : useHwAccel ? 'auto' : 'software',
  };
}

function detectCrop(ffmpegPath, sourcePath, options = {}) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error('FFmpeg non trovato'));
      return;
    }
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      reject(new Error('Video non trovato'));
      return;
    }
    const total = Math.max(0, num(options.duration));
    const sample = clamp(total ? Math.min(20, Math.max(6, total / 10)) : 8, 3, 30);
    const start = total > sample * 2 ? Math.max(0, total / 2 - sample / 2) : 0;
    const args = [
      '-hide_banner',
      '-nostdin',
      '-loglevel',
      'info',
      ...(start > 0 ? ['-ss', fixed(start, 3)] : []),
      '-t',
      fixed(sample, 3),
      '-i',
      sourcePath,
      '-vf',
      'cropdetect=24:2:0',
      '-f',
      'null',
      DEV_NULL,
    ];

    let child;
    try {
      child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      reject(error);
      return;
    }
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 200000) stderr = stderr.slice(-100000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      const matches = [...stderr.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)];
      const last = matches[matches.length - 1];
      if (!last) {
        if (code !== 0) reject(new Error(`Analisi non riuscita (codice ${code})`));
        else resolve({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 });
        return;
      }
      const width = Number(last[1]);
      const height = Number(last[2]);
      const left = Number(last[3]);
      const top = Number(last[4]);
      let frameW = safeInt(options.width, 0, 20000, 0);
      let frameH = safeInt(options.height, 0, 20000, 0);
      if (!frameW || !frameH) {
        const streamLine = stderr.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
        if (streamLine) {
          frameW = Number(streamLine[1]);
          frameH = Number(streamLine[2]);
        }
      }
      if (width < 32 || height < 32) {
        resolve({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 });
        return;
      }
      resolve({
        left,
        top,
        width,
        height,
        right: frameW ? Math.max(0, frameW - left - width) : 0,
        bottom: frameH ? Math.max(0, frameH - top - height) : 0,
        frameWidth: frameW,
        frameHeight: frameH,
      });
    });
  });
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

function parseProgressLine(line, plan, pass, range, onProgress) {
  const match = line.match(/^(out_time_us|out_time_ms)=(\d+)/);
  if (!match) return;
  const seconds = Math.max(0, Number(match[2]) / 1e6 - (plan.startSeconds || 0));
  const total = plan.duration || 1;
  const local = clamp(seconds / total, 0, 0.999);
  const progress = range.start + local * (range.end - range.start);
  if (onProgress) {
    onProgress({
      progress: clamp(progress, 0, 0.999),
      seconds,
      total,
      pass,
      passProgress: local,
    });
  }
}

function runFfmpeg(ffmpegPath, args, { plan, pass, range, onProgress, logLabel }) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      reject(error);
      return;
    }
    let stdoutBuffer = '';
    const stderrChunks = [];
    let settled = false;

    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        parseProgressLine(line, plan, pass, range, onProgress);
        const speed = line.match(/^speed=(\S+)/);
        if (speed && onProgress) onProgress({ progress: null, speed: speed[1], pass });
      }
    });
    child.stderr.on('data', (chunk) => {
      stderrChunks.push(chunk.toString());
      if (stderrChunks.length > 80) stderrChunks.shift();
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) resolve();
      else {
        const details = stderrChunks.join('').trim().split(/\r?\n/).slice(-8).join(' ');
        reject(new Error(details || `${logLabel || 'FFmpeg'} ha restituito ${code}`));
      }
    });
  });
}

function friendlyHardwareError(error, encoderId) {
  const message = String((error && error.message) || error || '');
  if (message.startsWith("L'encoder GPU")) return error;
  if (
    !SOFTWARE_ENCODERS.has(encoderId) &&
    /no capable devices|error while opening encoder|failed to open|error creating a .*session|not supported|cannot load|no device/i.test(
      message,
    )
  ) {
    return new Error(
      `L'encoder GPU ${encoderId} non è disponibile su questo sistema. Fai una nuova scansione GPU o scegli un encoder software. Dettaglio: ${message}`,
    );
  }
  return error;
}

function compressVideo({ ffmpegPath, ffprobePath, sourcePath, options, outputPath, onProgress }) {
  let child = null;
  let cancelled = false;
  const randomId = Math.random().toString(36).slice(2, 8);
  const passLogBase = path.join(os.tmpdir(), `moli-pass-${Date.now()}-${process.pid}-${randomId}`);
  let tempOutput = null;

  const promise = (async () => {
    if (!ffmpegPath) throw new Error('FFmpeg non trovato');
    if (!ffprobePath) throw new Error('ffprobe non trovato');
    if (typeof sourcePath !== 'string' || !sourcePath || !fs.existsSync(sourcePath)) {
      throw new Error('Scegli un video da comprimere');
    }
    if (typeof outputPath !== 'string' || !outputPath || outputPath.includes('\u0000')) {
      throw new Error('Scegli un file di output valido');
    }
    const resolvedOutput = path.resolve(outputPath);
    if (resolvedOutput.length > 4096) throw new Error('Percorso di output troppo lungo');
    if (path.resolve(sourcePath) === resolvedOutput) {
      throw new Error('Il file di output non può essere lo stesso del file di input');
    }

    const source = await probeSource(ffprobePath, sourcePath);
    if (!source.hasVideo) throw new Error('Il file selezionato non contiene video');
    const plan = buildCompressPlan({ source, options, outputPath });
    const warnings = [...plan.warnings];
    const outputDir = path.dirname(outputPath);
    fs.mkdirSync(outputDir, { recursive: true });

    const extension = plan.extension;
    const parsed = path.parse(outputPath);
    tempOutput = path.join(parsed.dir, `${parsed.name}.moliparts-${Date.now()}-${randomId}.${extension}`);
    plan.args[plan.args.length - 1] = tempOutput;

    const twoPass = plan.qualityMode === 'twopass';
    try {
      if (twoPass) {
        const pass1 = [
          '-hide_banner',
          '-loglevel',
          'warning',
          '-y',
          ...plan.seekArgs,
          '-i',
          sourcePath,
          ...plan.trimArgs,
          '-progress',
          'pipe:1',
          '-stats_period',
          '0.25',
          '-nostats',
          '-map',
          `0:${plan.videoIndex}`,
        ];
        if (plan.videoFilter) pass1.push('-vf', plan.videoFilter);
        pass1.push(...plan.videoArgs);
        pass1.push('-pass', '1', '-passlogfile', passLogBase, '-an', '-sn', '-dn', '-f', 'null', DEV_NULL);

        if (twoPass) {
          plan.args.splice(plan.args.length - 1, 0, '-pass', '2', '-passlogfile', passLogBase);
        }

        await new Promise((resolve, reject) => {
          let spawnChild;
          try {
            spawnChild = spawn(ffmpegPath, pass1, {
              windowsHide: true,
              stdio: ['ignore', 'pipe', 'pipe'],
            });
          } catch (error) {
            reject(error);
            return;
          }
          child = spawnChild;
          let stdoutBuffer = '';
          const stderrChunks = [];
          spawnChild.stdout.on('data', (chunk) => {
            stdoutBuffer += chunk.toString();
            const lines = stdoutBuffer.split(/\r?\n/);
            stdoutBuffer = lines.pop() || '';
            for (const line of lines) parseProgressLine(line, plan, 1, { start: 0, end: 0.45 }, onProgress);
          });
          spawnChild.stderr.on('data', (chunk) => {
            stderrChunks.push(chunk.toString());
            if (stderrChunks.length > 80) stderrChunks.shift();
          });
          spawnChild.on('error', reject);
          spawnChild.on('close', (code) => {
            if (code === 0) resolve();
            else {
              const details = stderrChunks.join('').trim().split(/\r?\n/).slice(-8).join(' ');
              reject(new Error(details || 'Prima passata FFmpeg fallita'));
            }
          });
        });
        if (cancelled) throw new Error('Compressione annullata');
      }

      const runFinal = (args) =>
        new Promise((resolve) => {
          let spawnChild;
          try {
            spawnChild = spawn(ffmpegPath, args, {
              windowsHide: true,
              stdio: ['ignore', 'pipe', 'pipe'],
            });
          } catch (error) {
            resolve({ code: -1, details: error.message });
            return;
          }
          child = spawnChild;
          let stdoutBuffer = '';
          const stderrChunks = [];
          spawnChild.stdout.on('data', (chunk) => {
            stdoutBuffer += chunk.toString();
            const lines = stdoutBuffer.split(/\r?\n/);
            stdoutBuffer = lines.pop() || '';
            for (const line of lines) {
              parseProgressLine(
                line,
                plan,
                twoPass ? 2 : 1,
                twoPass ? { start: 0.45, end: 1 } : { start: 0, end: 1 },
                onProgress,
              );
              const speed = line.match(/^speed=(\S+)/);
              if (speed && onProgress) onProgress({ progress: null, speed: speed[1], pass: twoPass ? 2 : 1 });
            }
          });
          spawnChild.stderr.on('data', (chunk) => {
            stderrChunks.push(chunk.toString());
            if (stderrChunks.length > 80) stderrChunks.shift();
          });
          spawnChild.on('error', (error) => resolve({ code: -1, details: error.message }));
          spawnChild.on('close', (code) => {
            const details = stderrChunks.join('').trim().split(/\r?\n/).slice(-8).join(' ');
            resolve({ code, details });
          });
        });

      let finalRun = await runFinal(plan.args);
      let usedHwaccel = Boolean(plan.hwaccel);
      if (finalRun.code !== 0 && plan.hwaccel) {
        try {
          if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
        } catch {
          /* ignore */
        }
        const fallbackArgs = [];
        for (let index = 0; index < plan.args.length; index += 1) {
          if (plan.args[index] === '-hwaccel') {
            index += 1;
            if (plan.args[index + 1] === '-hwaccel_output_format') index += 2;
            continue;
          }
          fallbackArgs.push(plan.args[index]);
        }
        if (onProgress) onProgress({ progress: 0, pass: twoPass ? 2 : 1, hwaccelFallback: true });
        finalRun = await runFinal(fallbackArgs);
        usedHwaccel = false;
        if (finalRun.code === 0) {
          warnings.push('Decodifica GPU non disponibile: ho usato la decodifica software.');
        }
      }
      if (cancelled) throw new Error('Compressione annullata');
      if (finalRun.code !== 0) {
        throw friendlyHardwareError(
          new Error(finalRun.details || `FFmpeg ha restituito ${finalRun.code}`),
          plan.encoderId,
        );
      }
      if (!fs.existsSync(tempOutput)) throw new Error('FFmpeg non ha prodotto il file di output');
      const stat = fs.statSync(tempOutput);
      if (!stat.size) throw new Error('Il file compresso è vuoto');
      try {
        if (isWin && fs.existsSync(outputPath)) fs.rmSync(outputPath, { force: true });
        fs.renameSync(tempOutput, outputPath);
      } catch {
        fs.copyFileSync(tempOutput, outputPath);
        fs.unlinkSync(tempOutput);
      }
      tempOutput = null;

      let output = null;
      try {
        output = await probeSource(ffprobePath, outputPath);
      } catch {
        /* metadata is optional */
      }
      if (onProgress) {
        onProgress({
          progress: 1,
          seconds: plan.duration,
          total: plan.duration,
          pass: twoPass ? 2 : 1,
          size: stat.size,
        });
      }
      return {
        path: outputPath,
        name: path.basename(outputPath),
        size: stat.size,
        sourceSize: source.size,
        saved: source.size > 0 ? Math.max(0, 1 - stat.size / source.size) : null,
        duration: plan.duration,
        container: plan.container,
        encoder: plan.encoderId,
        encoderLabel: plan.encoder.label,
        hardware: plan.encoder.hardware,
        qualityMode: plan.qualityMode,
        videoCodec: output && output.videoTracks[0] ? output.videoTracks[0].codec : plan.encoder.codec,
        audioCodecs: output ? output.audioTracks.map((track) => track.codec) : [],
        audioTracks: plan.audio.tracks.length,
        mergedAudio: plan.audio.merge,
        subtitleTracks: plan.subtitles.tracks.length,
        burnedSubtitles: plan.burned,
        loudnorm: plan.loudnorm,
        rangeStart: plan.rangeStart,
        rangeEnd: plan.rangeEnd,
        warnings,
        hwaccel: usedHwaccel,
        hwaccelMode: usedHwaccel ? plan.hwaccelMode : 'software',
        estimate: plan.estimate,
      };
    } catch (error) {
      if (cancelled) throw new Error('Compressione annullata');
      throw friendlyHardwareError(error, plan.encoderId);
    } finally {
      try {
        if (tempOutput && fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
      } catch {
        /* ignore */
      }
      for (const suffix of ['', '.mbtree', '.log', '.log.mbtree']) {
        try {
          const candidate = `${passLogBase}${suffix}`;
          if (fs.existsSync(candidate)) fs.unlinkSync(candidate);
        } catch {
          /* ignore */
        }
      }
    }
  })();

  promise.cancel = () => {
    cancelled = true;
    killTree(child);
  };

  return promise;
}

module.exports = {
  probeSource,
  buildCompressPlan,
  compressVideo,
  containerExtension,
  containerOf,
  buildVideoFilters,
  resolvePixelFormat,
  estimatePlan,
  detectCrop,
  TEXT_SUBTITLE_CODECS,
};
