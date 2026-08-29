import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, readdir, readlink, rename, rm, stat } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { Transform } from 'node:stream';
import { fileURLToPath, URL } from 'node:url';
import * as prompts from '@clack/prompts';
import { ZipArchive } from 'archiver';
import cliProgress from 'cli-progress';
import { UsageError } from './cli-options.mjs';
import { isInteractive, promptRoot } from './interactive-options.mjs';
import { installedVersion } from './nextui-release.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const excludedNames = new Set(['.DS_Store', '.Spotlight-V100', '.Trashes', '.fseventsd']);

function cancel(value) {
  if (prompts.isCancel(value)) throw new Error('Backup cancelled');
  return value;
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => {
      reject(
        error.code === 'ENOENT'
          ? new Error(`${command} is required to create NextUI backups`)
          : error,
      );
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed: ${stderr.trim() || `exit ${code}`}`));
    });
  });
}

function isExcluded(relativePath) {
  return relativePath.split('/').some((segment) => excludedNames.has(segment));
}

async function scanPayload(root) {
  const entries = [];
  let totalBytes = 0;
  let fileCount = 0;

  async function visit(directory, relativeDirectory = '') {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const relativePath = path.posix.join(relativeDirectory, child.name);
      if (isExcluded(relativePath)) continue;
      const absolutePath = path.join(directory, child.name);
      const stats = await lstat(absolutePath);
      if (stats.isDirectory()) {
        entries.push({ type: 'directory', absolutePath, relativePath, stats });
        await visit(absolutePath, relativePath);
      } else if (stats.isFile()) {
        entries.push({ type: 'file', absolutePath, relativePath, stats });
        totalBytes += stats.size;
        fileCount += 1;
      } else if (stats.isSymbolicLink()) {
        entries.push({
          type: 'symlink',
          absolutePath,
          relativePath,
          stats,
          target: await readlink(absolutePath),
        });
      }
    }
  }

  await visit(root);
  return { entries, totalBytes, fileCount };
}

function backupName(root) {
  const label = path.basename(root).replace(/[^a-z0-9._-]+/gi, '-') || 'sd-card';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `nextui-${label}-${timestamp}.zip`;
}

async function selectRoot(options) {
  if (!options.root) {
    if (!isInteractive(options)) throw new UsageError('--root is required');
    options.root = await promptRoot();
  }
  const root = path.resolve(options.root);
  if (!(await stat(root).catch(() => null))?.isDirectory()) {
    throw new Error(`SD-card root is not a directory: ${root}`);
  }
  return root;
}

async function selectOutput(root, options) {
  const suggested = path.join(projectRoot, 'backups', backupName(root));
  let selected = options.output;
  if (!selected) {
    if (!isInteractive(options))
      throw new UsageError('backup requires --output outside a terminal');
    selected = cancel(
      await prompts.text({
        message: 'Backup file',
        defaultValue: suggested,
        placeholder: suggested,
        validate: (value) => (value.trim() ? undefined : 'Enter a backup path.'),
      }),
    );
  }

  let output = path.resolve(selected.trim());
  if ((await stat(output).catch(() => null))?.isDirectory()) {
    output = path.join(output, backupName(root));
  } else if (path.extname(output).toLowerCase() !== '.zip') {
    output += '.zip';
  }

  const relative = path.relative(root, output);
  if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new Error('Backup output must be outside the SD card');
  }
  return output;
}

async function confirmBackup(root, output, installed, payload, options) {
  if (options.yes) return;
  if (!isInteractive(options)) throw new UsageError('backup requires --yes outside a terminal');
  prompts.note(
    [
      `Source: ${root}`,
      `Installed: ${installed.build || (installed.installed ? 'unknown NextUI build' : 'not detected')}`,
      `Destination: ${output}`,
      `Payload: ${humanSize(payload.totalBytes)} across ${payload.fileCount} files`,
      'Contents: all card files, including hidden NextUI data, ROMs, BIOS, saves, and tools.',
      'Excluded: .DS_Store, .Spotlight-V100, .Trashes, and .fseventsd.',
      'The SD card will not be modified.',
    ].join('\n'),
    'NextUI backup',
  );
  const confirmed = cancel(await prompts.confirm({ message: 'Create this compressed backup?' }));
  if (!confirmed) throw new Error('Backup cancelled');
}

async function confirmReplacement(output, options) {
  const outputStat = await stat(output).catch(() => null);
  if (!outputStat) return;
  if (!outputStat.isFile()) throw new Error(`Backup destination is not a file: ${output}`);
  if (options.yes) return;
  if (!isInteractive(options)) throw new Error(`Backup already exists: ${output}`);
  const confirmed = cancel(
    await prompts.confirm({ message: `Replace existing backup ${output}?`, initialValue: false }),
  );
  if (!confirmed) throw new Error('Backup cancelled');
}

async function withSpinner(options, message, task) {
  if (!isInteractive(options)) return task();
  const spinner = prompts.spinner();
  spinner.start(message);
  try {
    const result = await task();
    spinner.stop(message);
    return result;
  } catch (error) {
    spinner.stop(`${message} failed`);
    throw error;
  }
}

function humanSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '--';
  const rounded = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}

function createProgressBar(options) {
  if (!isInteractive(options)) return null;
  return new cliProgress.SingleBar(
    {
      format:
        'Backing up [{bar}] {percentage}% | {processed}/{totalSize} | {speed} | ETA {etaText}',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      barsize: 24,
      fps: 8,
      hideCursor: true,
      clearOnComplete: false,
    },
    cliProgress.Presets.shades_classic,
  );
}

async function appendEntry(archive, entry, countBytes) {
  const appended = once(archive, 'entry');
  if (entry.type === 'directory') {
    archive.append(Buffer.alloc(0), {
      name: `${entry.relativePath}/`,
      type: 'directory',
      stats: entry.stats,
    });
  } else if (entry.type === 'symlink') {
    archive.symlink(entry.relativePath, entry.target, entry.stats.mode);
  } else {
    const source = createReadStream(entry.absolutePath);
    const meter = new Transform({
      transform(chunk, encoding, callback) {
        countBytes(chunk.length);
        callback(null, chunk);
      },
    });
    source.on('error', (error) => meter.destroy(error));
    archive.append(source.pipe(meter), { name: entry.relativePath, stats: entry.stats });
  }
  await appended;
}

async function createArchive(root, destination, payload, options) {
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const output = createWriteStream(destination, { flags: 'wx' });
  const completed = once(output, 'close');
  archive.pipe(output);

  const progressBar = createProgressBar(options);
  const startedAt = performance.now();
  let processedBytes = 0;
  const progressTotal = Math.max(payload.totalBytes, 1);
  const updateProgress = (increment = 0, complete = false) => {
    processedBytes += increment;
    const elapsedSeconds = Math.max((performance.now() - startedAt) / 1000, 0.001);
    const speed = processedBytes / elapsedSeconds;
    const remaining = Math.max(payload.totalBytes - processedBytes, 0);
    progressBar?.update(complete ? progressTotal : Math.min(processedBytes, progressTotal), {
      processed: humanSize(processedBytes),
      totalSize: humanSize(payload.totalBytes),
      speed: `${humanSize(speed)}/s`,
      etaText: formatDuration(speed > 0 ? remaining / speed : Number.POSITIVE_INFINITY),
    });
  };

  progressBar?.start(progressTotal, 0, {
    processed: humanSize(0),
    totalSize: humanSize(payload.totalBytes),
    speed: '0 B/s',
    etaText: '--',
  });
  try {
    for (const entry of payload.entries) {
      await appendEntry(archive, entry, updateProgress);
    }
    await archive.finalize();
    await completed;
    updateProgress(0, true);
  } catch (error) {
    archive.abort();
    output.destroy();
    throw error;
  } finally {
    progressBar?.stop();
  }
}

export async function runBackup(options, emit) {
  if (isInteractive(options)) prompts.intro('NextUI backup');
  const root = await selectRoot(options);
  const output = await selectOutput(root, options);
  const installed = await installedVersion(root);
  const payload = await withSpinner(options, 'Measuring SD-card data', () => scanPayload(root));
  await confirmBackup(root, output, installed, payload, options);
  await confirmReplacement(output, options);

  emit(options, 'source', `Source: ${root}`, { root });
  emit(options, 'destination', `Destination: ${output}`, { output });
  if (options.dryRun) {
    emit(options, 'complete', `Dry run: would create ${output}`);
    return;
  }

  await mkdir(path.dirname(output), { recursive: true });
  const temporary = path.join(
    path.dirname(output),
    `.${path.basename(output)}.tmp-${process.pid}.zip`,
  );
  try {
    await createArchive(root, temporary, payload, options);
    await withSpinner(options, 'Verifying backup archive', () =>
      run('unzip', ['-tq', temporary], root),
    );
    await rm(output, { force: true });
    await rename(temporary, output);
  } finally {
    await rm(temporary, { force: true });
  }

  const size = (await stat(output)).size;
  emit(options, 'complete', `Backup complete: ${output} (${humanSize(size)})`, {
    output,
    size,
  });
  if (isInteractive(options)) prompts.outro('NextUI backup verified');
}
