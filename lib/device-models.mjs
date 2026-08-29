export const devices = {
  brick: {
    label: 'TrimUI Brick or Hammer',
    relativeDirectory: 'Tools/tg5040/Bootlogo.pak/brick',
    width: 1024,
    height: 768,
  },
  brickpro: {
    label: 'TrimUI Brick Pro',
    relativeDirectory: 'Tools/tg5040/Bootlogo.pak/brick',
    width: 1024,
    height: 768,
  },
  smartpro: {
    label: 'TrimUI Smart Pro',
    relativeDirectory: 'Tools/tg5040/Bootlogo.pak/smartpro',
    width: 1280,
    height: 720,
  },
  smartpros: {
    label: 'TrimUI Smart Pro S',
    relativeDirectory: 'Tools/tg5050/Bootlogo.pak/smartpro',
    width: 1280,
    height: 720,
  },
};

const deviceAliases = new Map([
  ['brick', 'brick'],
  ['hammer', 'brick'],
  ['brickpro', 'brickpro'],
  ['brick-pro', 'brickpro'],
  ['smartpro', 'smartpro'],
  ['smart-pro', 'smartpro'],
  ['smartpros', 'smartpros'],
  ['smart-pro-s', 'smartpros'],
]);

export function normalizeDevice(value) {
  const normalized = value?.trim().toLowerCase().replaceAll('_', '-');
  const device = deviceAliases.get(normalized);
  if (!device) {
    throw new Error(
      `Unsupported device "${value}". Expected brick, brickpro, smartpro, or smartpros.`,
    );
  }
  return device;
}
