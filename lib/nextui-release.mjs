import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, URL } from 'node:url';
import * as prompts from '@clack/prompts';
import { UsageError } from './cli-options.mjs';
import { isInteractive, promptRoot } from './interactive-options.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const defaultReleaseApi = 'https://api.github.com/repos/LoveRetro/NextUI/releases/latest';

function cancel(value, message) {
  if (prompts.isCancel(value)) throw new Error(message);
  return value;
}

function run(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} failed: ${stderr.trim() || `exit ${code}`}`));
    });
    child.stdin.end(input);
  });
}

async function readJson(source) {
  if (!source.includes('://')) return JSON.parse(await readFile(path.resolve(source), 'utf8'));
  if (source.startsWith('file:')) return JSON.parse(await readFile(fileURLToPath(source), 'utf8'));

  const response = await globalThis.fetch(source, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'nientiendo' },
    signal: globalThis.AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Release lookup failed: HTTP ${response.status}`);
  return response.json();
}

function releaseBuild(assetName) {
  return assetName.replace(/-(?:base|all)\.zip$/, '');
}

async function latestRelease() {
  const release = await readJson(process.env.NEXTUI_RELEASE_API || defaultReleaseApi);
  if (release.draft || release.prerelease || !Array.isArray(release.assets)) {
    throw new Error('Latest GitHub release metadata is invalid');
  }

  const assets = Object.fromEntries(
    ['base', 'all'].map((kind) => [
      kind,
      release.assets.find((asset) => asset.name?.endsWith(`-${kind}.zip`)),
    ]),
  );
  if (!assets.base || !assets.all) throw new Error('Latest release is missing base or all archive');

  return {
    tag: release.tag_name,
    page: release.html_url,
    build: releaseBuild(assets.base.name),
    assets,
  };
}

export async function installedVersion(root) {
  const versionPath = path.join(root, '.system', 'version.txt');
  const contents = await readFile(versionPath, 'utf8').catch(() => null);
  if (contents !== null) {
    const [build, hash] = contents.trim().split(/\r?\n/, 2);
    return { installed: true, build: build || null, hash: hash || null };
  }

  const markers = ['tg5040', 'tg5050'];
  for (const marker of markers) {
    if ((await stat(path.join(root, '.system', marker)).catch(() => null))?.isDirectory()) {
      return { installed: true, build: null, hash: null };
    }
  }
  return { installed: false, build: null, hash: null };
}

function parseStableBuild(build) {
  const match = /^NextUI-(\d{8})-(\d+)$/.exec(build || '');
  return match ? [Number(match[1]), Number(match[2])] : null;
}

function compareBuilds(installed, latest) {
  if (!installed) return 'unknown';
  if (installed === latest) return 'current';
  const left = parseStableBuild(installed);
  const right = parseStableBuild(latest);
  if (!left || !right) return 'different';
  if (left[0] > right[0] || (left[0] === right[0] && left[1] > right[1])) return 'newer';
  return 'update';
}

async function plistToJson(plist) {
  return JSON.parse(await run('plutil', ['-convert', 'json', '-o', '-', '--', '-'], plist));
}

async function macMediaInfo(root) {
  const volume = await plistToJson(await run('diskutil', ['info', '-plist', root]));
  if (!volume.ParentWholeDisk) throw new Error(`Cannot identify the disk containing ${root}`);
  const listing = await plistToJson(
    await run('diskutil', ['list', '-plist', `/dev/${volume.ParentWholeDisk}`]),
  );
  const disk = listing.AllDisksAndPartitions?.find(
    (entry) => entry.DeviceIdentifier === volume.ParentWholeDisk,
  );
  return {
    filesystem: volume.FilesystemType,
    partitionScheme: disk?.Content,
    mountPoint: volume.MountPoint,
  };
}

async function linuxMediaInfo(root) {
  const mounts = JSON.parse(
    await run('findmnt', ['--json', '-T', root, '-o', 'TARGET,FSTYPE,SOURCE']),
  );
  const mount = mounts.filesystems?.[0];
  if (!mount?.source) throw new Error(`Cannot identify the device mounted at ${root}`);
  const disks = JSON.parse(
    await run('lsblk', ['--json', '-o', 'PATH,PKNAME,PTTYPE', mount.source]),
  );
  const block = disks.blockdevices?.[0];
  const diskPath = block?.pkname ? `/dev/${block.pkname}` : block?.path;
  const wholeDisk = JSON.parse(await run('lsblk', ['--json', '-o', 'PTTYPE', diskPath]));
  return {
    filesystem: mount.fstype,
    partitionScheme: wholeDisk.blockdevices?.[0]?.pttype,
    mountPoint: mount.target,
  };
}

async function windowsMediaInfo(root) {
  const drive = path.parse(root).root.slice(0, 1);
  const script = [
    `$volume = Get-Volume -DriveLetter '${drive}'`,
    `$partition = Get-Partition -DriveLetter '${drive}'`,
    '$disk = Get-Disk -Number $partition.DiskNumber',
    '[pscustomobject]@{filesystem=$volume.FileSystem;partitionScheme=$disk.PartitionStyle} | ConvertTo-Json -Compress',
  ].join('; ');
  return {
    ...JSON.parse(await run('powershell.exe', ['-NoProfile', '-Command', script])),
    mountPoint: path.parse(root).root,
  };
}

async function mediaInfo(root) {
  if (process.env.NEXTUI_MEDIA_INFO) {
    return { mountPoint: root, ...JSON.parse(process.env.NEXTUI_MEDIA_INFO) };
  }
  if (process.platform === 'darwin') return macMediaInfo(root);
  if (process.platform === 'linux') return linuxMediaInfo(root);
  if (process.platform === 'win32') return windowsMediaInfo(root);
  throw new Error(`Cannot validate SD-card media on ${process.platform}`);
}

function validateMedia(info, root) {
  const filesystem = String(info.filesystem || '').toLowerCase();
  const partitionScheme = String(info.partitionScheme || '').toLowerCase();
  const validFilesystem = ['exfat', 'fat32', 'msdos', 'vfat'].includes(filesystem);
  const validScheme = ['fdisk_partition_scheme', 'mbr', 'dos'].includes(partitionScheme);
  if (!validFilesystem || !validScheme) {
    throw new Error(
      `Incompatible SD card: filesystem is ${info.filesystem || 'unknown'} and partition scheme is ${info.partitionScheme || 'unknown'}. Reformat it as FAT32 or exFAT with a Master Boot Record partition map, then try again.`,
    );
  }
  if (!info.mountPoint || path.resolve(info.mountPoint) !== path.resolve(root)) {
    throw new Error(
      `Install target is not the mounted SD-card root: ${root}. Select ${info.mountPoint || 'the volume root'} instead.`,
    );
  }
}

function humanSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

async function chooseInstallKind(options) {
  if (options.kind) return options.kind;
  if (!isInteractive(options)) throw new UsageError('install requires --kind base or --kind all');
  return cancel(
    await prompts.select({
      message: 'Release contents',
      options: [
        { value: 'base', label: 'Base', hint: 'normal installation' },
        { value: 'all', label: 'All', hint: 'includes extra emulators and tools' },
      ],
      initialValue: 'base',
    }),
    'Installation cancelled',
  );
}

async function chooseUpdateMode(options) {
  if (options.repair) return 'repair';
  if (!isInteractive(options)) return 'normal';
  return cancel(
    await prompts.select({
      message: 'Update mode',
      options: [
        { value: 'normal', label: 'Normal update', hint: 'copy MinUI.zip only' },
        { value: 'repair', label: 'Repair update', hint: 'also recopy trimui/' },
      ],
      initialValue: 'normal',
    }),
    'Update cancelled',
  );
}

async function confirmFresh(root, release, asset, kind, media, entryCount, options) {
  if (options.yes) return;
  if (!isInteractive(options)) throw new UsageError('install requires --yes outside a terminal');

  prompts.note(
    [
      `Target: ${root}`,
      `Media: ${media.filesystem}, ${media.partitionScheme}`,
      `Release: ${release.tag} (${release.build}, ${kind}, ${humanSize(asset.size)})`,
      `Current root entries: ${entryCount}`,
      'Impact: copies release contents to the card root and overwrites matching paths.',
      'It does not format the card or supply ROMs or BIOS files.',
    ].join('\n'),
    'Fresh NextUI installation',
  );

  const backedUp = cancel(
    await prompts.confirm({ message: 'Have you backed up everything important on this card?' }),
    'Installation cancelled',
  );
  if (!backedUp) throw new Error('Installation cancelled: back up the card first');

  const targetConfirmed = cancel(
    await prompts.confirm({
      message: `Install NextUI to ${root}? Matching files will be overwritten.`,
    }),
    'Installation cancelled',
  );
  if (!targetConfirmed) throw new Error('Installation cancelled');

  const typed = cancel(
    await prompts.text({
      message: 'Type INSTALL to confirm the target and begin',
      validate: (value) => (value === 'INSTALL' ? undefined : 'Type INSTALL exactly.'),
    }),
    'Installation cancelled',
  );
  if (typed !== 'INSTALL') throw new Error('Installation cancelled');
}

async function confirmUpdate(root, installed, release, mode, options) {
  if (options.yes) return;
  if (!isInteractive(options)) throw new UsageError('update requires --yes outside a terminal');
  prompts.note(
    [
      `Target: ${root}`,
      `Installed: ${installed.build || 'unknown build'}`,
      `Available: ${release.tag} (${release.build})`,
      `Mode: ${mode === 'repair' ? 'MinUI.zip and trimui/' : 'MinUI.zip only'}`,
      'ROMs, saves, BIOS files, artwork, and Paks are left in place. Back up the card first.',
    ].join('\n'),
    mode === 'repair' ? 'NextUI repair update' : 'NextUI update',
  );
  const confirmed = cancel(
    await prompts.confirm({ message: 'Copy this update to the selected card?' }),
    'Update cancelled',
  );
  if (!confirmed) throw new Error('Update cancelled');
}

async function hashFile(filePath) {
  const hash = createHash('sha256');
  const file = await open(filePath, 'r');
  try {
    for await (const chunk of file.readableWebStream()) hash.update(chunk);
  } finally {
    await file.close().catch(() => {});
  }
  return hash.digest('hex');
}

async function downloadAsset(asset, destination) {
  const source = asset.browser_download_url;
  if (!source?.includes('://')) {
    await copyFile(path.resolve(source), destination);
  } else if (source.startsWith('file:')) {
    await copyFile(fileURLToPath(source), destination);
  } else {
    const response = await globalThis.fetch(source, {
      signal: globalThis.AbortSignal.timeout(10 * 60_000),
    });
    if (!response.ok || !response.body) {
      throw new Error(`Download failed: HTTP ${response.status}`);
    }
    await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
  }

  const expected = /^sha256:([a-f0-9]{64})$/i.exec(asset.digest || '')?.[1];
  if (!expected) throw new Error(`Release asset has no SHA-256 digest: ${asset.name}`);
  const actual = await hashFile(destination);
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`SHA-256 mismatch for ${asset.name}`);
  }
}

async function inspectArchive(archive) {
  const entries = (await run('unzip', ['-Z1', archive]))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((entry) => entry.replaceAll('\\', '/'));
  for (const entry of entries) {
    if (entry.startsWith('/') || /^[a-z]:\//i.test(entry) || entry.split('/').includes('..')) {
      throw new Error(`Unsafe path in release archive: ${entry}`);
    }
  }
  if (!entries.includes('MinUI.zip') || !entries.some((entry) => entry.startsWith('trimui/'))) {
    throw new Error('Release archive does not contain MinUI.zip and trimui/ at its root');
  }
}

async function stageRelease(asset, task) {
  const temporaryRoot = path.join(projectRoot, 'tmp');
  await mkdir(temporaryRoot, { recursive: true });
  const work = await mkdtemp(path.join(temporaryRoot, 'nextui-'));
  const archive = path.join(work, asset.name);
  const staging = path.join(work, 'staging');
  await mkdir(staging);

  try {
    await task('Downloading and verifying release', async () => {
      await downloadAsset(asset, archive);
      await inspectArchive(archive);
    });
    await task('Extracting release archive', () => run('unzip', ['-q', archive, '-d', staging]));
    return { work, staging };
  } catch (error) {
    await rm(work, { recursive: true, force: true });
    throw error;
  }
}

async function copyFresh(staging, root) {
  for (const entry of await readdir(staging)) {
    await cp(path.join(staging, entry), path.join(root, entry), { recursive: true, force: true });
  }
}

async function copyUpdate(staging, root, mode) {
  const minUiTarget = path.join(root, 'MinUI.zip');
  const targetStat = await lstat(minUiTarget).catch(() => null);
  if (targetStat?.isSymbolicLink() || (targetStat && !targetStat.isFile())) {
    throw new Error(`Update target is not a regular file: ${minUiTarget}`);
  }
  await copyFile(path.join(staging, 'MinUI.zip'), minUiTarget);
  if (mode === 'repair') {
    await cp(path.join(staging, 'trimui'), path.join(root, 'trimui'), {
      recursive: true,
      force: true,
    });
  }
}

async function selectRoot(options, nextUiOnly) {
  if (options.root) {
    const root = path.resolve(options.root);
    if (!(await stat(root).catch(() => null))?.isDirectory()) {
      throw new Error(`SD-card root is not a directory: ${root}`);
    }
    return root;
  }
  if (!isInteractive(options)) throw new UsageError('--root is required');
  return promptRoot({ nextUiOnly });
}

async function withTask(options, message, task) {
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

function emitStatus(emit, options, root, installed, release) {
  const comparison = installed.installed
    ? compareBuilds(installed.build, release.build)
    : 'not-installed';
  emit(options, 'target', `Target: ${root}`, { root });
  emit(
    options,
    'installed',
    installed.installed
      ? `Installed: ${installed.build || 'NextUI, unknown build'}`
      : 'Installed: not detected',
    installed,
  );
  emit(options, 'latest', `Latest: ${release.tag} (${release.build})`, {
    tag: release.tag,
    build: release.build,
    page: release.page,
  });
  const messages = {
    current: 'Status: up to date',
    update: 'Status: update available',
    newer: 'Status: installed build is newer than the latest stable release',
    different: 'Status: installed and latest builds differ',
    unknown: 'Status: installed build cannot be compared',
    'not-installed': 'Status: NextUI is not installed',
  };
  emit(options, 'status', messages[comparison], { status: comparison });
  return comparison;
}

export async function runNextUiCommand(options, emit) {
  if (isInteractive(options)) prompts.intro(`NextUI ${options.command}`);
  const root = await selectRoot(options, options.command !== 'install');
  const installed = await installedVersion(root);
  const release = await withTask(options, 'Checking the latest NextUI release', latestRelease);
  const comparison = emitStatus(emit, options, root, installed, release);

  if (options.command === 'check') {
    if (isInteractive(options)) prompts.outro(release.page);
    return;
  }

  if (options.command === 'install') {
    if (installed.installed) {
      emit(options, 'complete', `NextUI is already installed at ${root}; use update`);
      return;
    }
    const media = await withTask(options, 'Validating SD-card format', () => mediaInfo(root));
    validateMedia(media, root);
    const kind = await chooseInstallKind(options);
    const asset = release.assets[kind];
    const entryCount = (await readdir(root)).length;
    await confirmFresh(root, release, asset, kind, media, entryCount, options);
    if (options.dryRun) {
      emit(options, 'complete', `Dry run: would install ${release.tag} (${kind}) to ${root}`);
      return;
    }

    const staged = await stageRelease(asset, (message, task) => withTask(options, message, task));
    try {
      await withTask(options, 'Copying NextUI to the SD card', () =>
        copyFresh(staged.staging, root),
      );
    } finally {
      await rm(staged.work, { recursive: true, force: true });
    }
    emit(options, 'complete', `NextUI ${release.tag} is ready on ${root}.`);
  } else {
    if (!installed.installed)
      throw new Error(`No NextUI installation found at ${root}; use install`);
    if (comparison === 'current' && !options.repair) {
      emit(options, 'complete', 'No update needed.');
      return;
    }
    const mode = await chooseUpdateMode(options);
    await confirmUpdate(root, installed, release, mode, options);
    if (options.dryRun) {
      emit(options, 'complete', `Dry run: would ${mode} update ${root} to ${release.tag}`);
      return;
    }

    const staged = await stageRelease(release.assets.base, (message, task) =>
      withTask(options, message, task),
    );
    try {
      await withTask(options, 'Copying the NextUI update', () =>
        copyUpdate(staged.staging, root, mode),
      );
    } finally {
      await rm(staged.work, { recursive: true, force: true });
    }
    emit(options, 'complete', `NextUI ${release.tag} ${mode} update is ready on ${root}.`);
  }

  emit(
    options,
    'next',
    'Safely eject the card, boot the device, and do not power it off during installation. Power it on again after the installer shuts it down.',
  );
  if (isInteractive(options)) prompts.outro('NextUI files copied successfully');
}
