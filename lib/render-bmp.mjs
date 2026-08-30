import { Buffer } from 'node:buffer';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

function backgroundForSource(source) {
  const name = path.basename(source).toLowerCase();
  if (name.endsWith('-on-white.svg') || name === 'black.svg') {
    return '#ffffff';
  }
  if (name.endsWith('-on-red.svg')) return '#e60012';
  return '#000000';
}

function encodeBmp(rgb, width, height) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowSize * height;
  const headerSize = 54;
  const bmp = Buffer.alloc(headerSize + pixelBytes);

  bmp.write('BM', 0, 2, 'ascii');
  bmp.writeUInt32LE(bmp.length, 2);
  bmp.writeUInt32LE(headerSize, 10);
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(width, 18);
  bmp.writeInt32LE(height, 22);
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(24, 28);
  bmp.writeUInt32LE(0, 30);
  bmp.writeUInt32LE(pixelBytes, 34);
  bmp.writeInt32LE(2835, 38);
  bmp.writeInt32LE(2835, 42);

  for (let sourceY = 0; sourceY < height; sourceY += 1) {
    const sourceRow = sourceY * width * 3;
    const targetRow = headerSize + (height - sourceY - 1) * rowSize;
    for (let x = 0; x < width; x += 1) {
      const sourcePixel = sourceRow + x * 3;
      const targetPixel = targetRow + x * 3;
      bmp[targetPixel] = rgb[sourcePixel + 2];
      bmp[targetPixel + 1] = rgb[sourcePixel + 1];
      bmp[targetPixel + 2] = rgb[sourcePixel];
    }
  }

  return bmp;
}

export async function renderSvg(source, model) {
  const sourceStat = await stat(source).catch(() => null);
  if (!sourceStat?.isFile()) throw new Error(`SVG source does not exist: ${source}`);
  if (path.extname(source).toLowerCase() !== '.svg') {
    throw new Error(`Source must be an SVG file: ${source}`);
  }

  const background = backgroundForSource(source);
  const image = sharp(source, { density: 288 });
  const metadata = await image.metadata();
  const scale = Math.min(model.width / metadata.width, model.height / metadata.height);
  const width = Math.round(metadata.width * scale);
  const height = Math.round(metadata.height * scale);
  const band = await image
    .resize(width, height)
    .flatten({ background })
    .removeAlpha()
    .png()
    .toBuffer();
  const { data, info } = await sharp({
    create: {
      width: model.width,
      height: model.height,
      channels: 3,
      background,
    },
  })
    .composite([
      {
        input: band,
        left: Math.floor((model.width - width) / 2),
        top: Math.floor((model.height - height) / 2),
      },
    ])
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.width !== model.width || info.height !== model.height || info.channels !== 3) {
    throw new Error(`Renderer produced an unexpected pixel format for ${source}`);
  }
  return encodeBmp(data, model.width, model.height);
}
