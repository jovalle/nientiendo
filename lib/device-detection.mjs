import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const tg5040Devices = ['brick', 'brickpro', 'smartpro'];
const deviceSuffix = /-(brickpro|smartpro|brick)\.cfg$/;
const deviceLogEntry = /config\.device_tag\s+(brickpro|smartpro|brick)\b/g;
const maxLogSize = 2 * 1024 * 1024;

async function isDirectory(directory) {
  return (await stat(directory).catch(() => null))?.isDirectory() ?? false;
}

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(entryPath)));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

function addEvidence(evidence, device, source, kind) {
  if (!evidence.some((item) => item.device === device && item.source === source)) {
    evidence.push({ device, source, kind });
  }
}

async function inspectTg5040(root, evidence) {
  const userdata = path.join(root, '.userdata', 'tg5040');
  if (!(await isDirectory(userdata))) return false;

  const files = await filesBelow(userdata);
  for (const file of files) {
    const suffixMatch = path.basename(file).match(deviceSuffix);
    if (suffixMatch) addEvidence(evidence, suffixMatch[1], file, 'runtime config');
  }

  for (const file of files.filter((candidate) => /\.(?:log|txt)$/i.test(candidate))) {
    const fileStat = await stat(file).catch(() => null);
    if (!fileStat?.isFile() || fileStat.size > maxLogSize) continue;
    const contents = await readFile(file, 'utf8').catch(() => '');
    for (const match of contents.matchAll(deviceLogEntry)) {
      addEvidence(evidence, match[1], file, 'runtime DEVICE tag');
    }
  }
  return true;
}

export async function inspectInstalledDevice(root) {
  const evidence = [];
  const activePlatforms = [];

  if (await inspectTg5040(root, evidence)) activePlatforms.push('tg5040');

  const tg5050Userdata = path.join(root, '.userdata', 'tg5050');
  if (await isDirectory(tg5050Userdata)) {
    activePlatforms.push('tg5050');
    addEvidence(evidence, 'smartpros', tg5050Userdata, 'runtime userdata');
  }

  const candidates = [...new Set(evidence.map((item) => item.device))];
  return { candidates, evidence, activePlatforms };
}

export function allowedDevicesForPlatforms(activePlatforms) {
  if (activePlatforms.length === 1 && activePlatforms[0] === 'tg5040') {
    return tg5040Devices;
  }
  if (activePlatforms.length === 1 && activePlatforms[0] === 'tg5050') {
    return ['smartpros'];
  }
  return ['brick', 'brickpro', 'smartpro', 'smartpros'];
}
