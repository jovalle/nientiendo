import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import * as prompts from '@clack/prompts';
import { devices, normalizeDevice } from './device-models.mjs';

const manualValue = '__manual__';

export function isInteractive(options) {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY && !options.json);
}

async function isDirectory(directory) {
  return (await stat(directory).catch(() => null))?.isDirectory() ?? false;
}

async function childDirectories(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(directory, entry.name));
}

async function isNextUiRoot(root) {
  return (
    (await isDirectory(path.join(root, '.system', 'tg5040'))) ||
    (await isDirectory(path.join(root, '.system', 'tg5050'))) ||
    (await isDirectory(path.join(root, 'Tools', 'tg5040', 'Bootlogo.pak'))) ||
    (await isDirectory(path.join(root, 'Tools', 'tg5050', 'Bootlogo.pak')))
  );
}

async function mountCandidates() {
  if (process.platform === 'darwin') return childDirectories('/Volumes');

  if (process.platform === 'linux') {
    const owners = [
      ...(await childDirectories('/media')),
      ...(await childDirectories('/run/media')),
    ];
    return [...owners, ...(await Promise.all(owners.map(childDirectories))).flat()];
  }

  if (process.platform === 'win32') {
    const drives = Array.from({ length: 26 }, (_, index) =>
      String.fromCharCode(65 + index).concat(':\\'),
    );
    const checks = await Promise.all(
      drives.map(async (drive) => ((await isDirectory(drive)) ? drive : null)),
    );
    return checks.filter(Boolean);
  }

  return [];
}

async function scanNextUiRoots() {
  const candidates = await mountCandidates();
  const matches = await Promise.all(
    candidates.map(async (candidate) => ((await isNextUiRoot(candidate)) ? candidate : null)),
  );
  return [...new Set(matches.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

async function promptForPath(message, placeholder) {
  const value = await prompts.text({
    message,
    placeholder,
    validate: (input) => (input.trim() ? undefined : 'Enter a path.'),
  });
  if (prompts.isCancel(value)) throw new Error('Selection cancelled');
  return path.resolve(value.trim());
}

export async function promptRoot({ nextUiOnly = true } = {}) {
  const spinner = prompts.spinner();
  spinner.start(nextUiOnly ? 'Scanning for mounted NextUI cards' : 'Scanning mounted volumes');
  const roots = nextUiOnly ? await scanNextUiRoots() : await mountCandidates();
  spinner.stop(
    roots.length > 0
      ? `Found ${roots.length} mounted ${nextUiOnly ? 'NextUI card(s)' : 'volume(s)'}`
      : `No mounted ${nextUiOnly ? 'NextUI cards' : 'volumes'} found`,
  );

  const selected = await prompts.select({
    message: nextUiOnly ? 'Select the NextUI SD card' : 'Select the target SD card',
    options: [
      ...roots.map((root) => ({ value: root, label: root })),
      { value: manualValue, label: 'Enter another path...' },
    ],
  });
  if (prompts.isCancel(selected)) throw new Error('SD-card selection cancelled');
  if (selected === manualValue) return promptForPath('NextUI SD-card path', '/Volumes/NEXTUI');
  return selected;
}

export async function promptDevice(allowed = Object.keys(devices)) {
  const selected = await prompts.select({
    message: 'Select the device model',
    options: [
      ...allowed.map((value) => ({ value, label: devices[value].label })),
      { value: manualValue, label: 'Enter another model...' },
    ],
  });
  if (prompts.isCancel(selected)) throw new Error('Device selection cancelled');
  if (selected !== manualValue) return selected;

  const value = await prompts.text({
    message: 'Device model',
    placeholder: allowed.join(', '),
    validate: (input) => {
      try {
        const device = normalizeDevice(input);
        return allowed.includes(device) ? undefined : `Expected ${allowed.join(', ')}.`;
      } catch (error) {
        return error.message;
      }
    },
  });
  if (prompts.isCancel(value)) throw new Error('Device selection cancelled');
  return normalizeDevice(value);
}

export async function promptSource(sources) {
  const selected = await prompts.select({
    message: 'Select the SVG source',
    options: [
      ...sources.map((source) => ({
        value: source,
        label: path.basename(source),
        hint: path.dirname(source),
      })),
      { value: manualValue, label: 'Enter another SVG path...' },
    ],
  });
  if (prompts.isCancel(selected)) throw new Error('Source selection cancelled');
  if (selected === manualValue) return promptForPath('SVG source path', './logo.svg');
  return selected;
}
