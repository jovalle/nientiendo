export class UsageError extends Error {}

export function usage() {
  return `Usage:
  nextui install --root SD_CARD [--kind base|all]
  nextui update --root SD_CARD [--repair]
  nextui check --root SD_CARD
  nextui backup --root SD_CARD [--output BACKUP.zip]
  nextui logos --root SD_CARD [--device DEVICE] [--source LOGO.svg]
  nextui detect --root SD_CARD
  nextui render --device DEVICE --source LOGO.svg --root SD_CARD
  nextui cleanup --root SD_CARD
  nextui uninstall --root SD_CARD

Options:
  --kind base|all          Fresh-install release contents
  --repair                 Recopy trimui/ during an update
  --device, --model DEVICE  Device model or alias
  --source FILE            SVG source; repeat for more than one logo
  --root DIRECTORY         Mounted NextUI SD-card root
  --output FILE            Backup archive path
  --dry-run                Show changes without writing them
  --yes                    Approve writes without prompting
  --json                   Emit newline-delimited JSON events
  --no-color               Disable colored progress output
  --help                   Show this help`;
}

export function parseArguments(argv) {
  const options = {
    command: 'install',
    sources: [],
    dryRun: false,
    yes: false,
    json: false,
    noColor: false,
    repair: false,
  };

  let firstOption = 0;
  if (argv[0] && !argv[0].startsWith('-')) {
    options.command = argv[0];
    firstOption = 1;
  }

  for (let index = firstOption; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      options.command = 'help';
    } else if (argument === '--dry-run') {
      options.dryRun = true;
    } else if (argument === '--yes') {
      options.yes = true;
    } else if (argument === '--json') {
      options.json = true;
    } else if (argument === '--no-color') {
      options.noColor = true;
    } else if (argument === '--repair') {
      options.repair = true;
    } else if (
      ['--root', '--output', '--device', '--model', '--source', '--kind'].includes(argument)
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new UsageError(`Missing value for ${argument}`);
      }
      index += 1;
      if (argument === '--root') options.root = value;
      if (argument === '--output') options.output = value;
      if (argument === '--device' || argument === '--model') options.device = value;
      if (argument === '--source') options.sources.push(value);
      if (argument === '--kind') options.kind = value;
    } else {
      throw new UsageError(`Unknown option: ${argument}`);
    }
  }

  if (options.kind && !['base', 'all'].includes(options.kind)) {
    throw new UsageError('--kind must be base or all');
  }

  return options;
}
