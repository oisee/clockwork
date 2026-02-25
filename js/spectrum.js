/**
 * ZX Spectrum screen renderer and attribute quantizer.
 *
 * Handles the Spectrum's peculiar screen memory layout (6144 pixel bytes +
 * 768 attribute bytes = 6912 total) and provides tools for converting
 * arbitrary images into Spectrum-compatible format with minimal color error.
 *
 * Screen layout:
 *   - 256x192 pixels, divided into 32x24 cells of 8x8 pixels
 *   - Each cell has one attribute byte: F B PPP III
 *     F = flash, B = bright, PPP = paper color (0-7), III = ink color (0-7)
 *   - Ink and paper within a cell share the same BRIGHT flag
 *   - Pixel bytes: bit 7 = leftmost pixel, bit 0 = rightmost
 *     1 = ink color, 0 = paper color
 */

// ---------------------------------------------------------------------------
// 1. Palette
// ---------------------------------------------------------------------------

/**
 * ZX Spectrum 16-color palette as [R, G, B] tuples.
 * Indices 0-7: normal brightness.  Indices 8-15: bright.
 * Index 0 and 8 are both black (bright black = black).
 */
export const PALETTE = [
  // Normal (B=0)
  [0x00, 0x00, 0x00], // 0  black
  [0x00, 0x00, 0xD7], // 1  blue
  [0xD7, 0x00, 0x00], // 2  red
  [0xD7, 0x00, 0xD7], // 3  magenta
  [0x00, 0xD7, 0x00], // 4  green
  [0x00, 0xD7, 0xD7], // 5  cyan
  [0xD7, 0xD7, 0x00], // 6  yellow
  [0xD7, 0xD7, 0xD7], // 7  white
  // Bright (B=1)
  [0x00, 0x00, 0x00], // 8  bright black (same as normal)
  [0x00, 0x00, 0xFF], // 9  bright blue
  [0xFF, 0x00, 0x00], // 10 bright red
  [0xFF, 0x00, 0xFF], // 11 bright magenta
  [0x00, 0xFF, 0x00], // 12 bright green
  [0x00, 0xFF, 0xFF], // 13 bright cyan
  [0xFF, 0xFF, 0x00], // 14 bright yellow
  [0xFF, 0xFF, 0xFF], // 15 bright white
];

// ---------------------------------------------------------------------------
// 2. Screen address calculation
// ---------------------------------------------------------------------------

/**
 * Compute the byte offset (0-6143) within pixel data for screen
 * coordinate (x, y) where x = 0..255, y = 0..191.
 *
 * The Spectrum's pixel layout interleaves thirds and character rows:
 *   third    = y >> 6          (0-2, which 64-line third)
 *   scanLine = y & 7           (0-7, line within character row)
 *   charRow  = (y >> 3) & 7   (0-7, character row within third)
 *   column   = x >> 3          (0-31, byte column)
 *
 *   address  = (third << 11) | (scanLine << 8) | (charRow << 5) | column
 */
export function pixelAddress(x, y) {
  const third    = y >> 6;
  const scanLine = y & 7;
  const charRow  = (y >> 3) & 7;
  const column   = x >> 3;
  return (third << 11) | (scanLine << 8) | (charRow << 5) | column;
}

/**
 * Compute the byte offset (6144-6911) for the attribute of cell (cx, cy)
 * where cx = 0..31, cy = 0..23.
 */
export function attrAddress(cx, cy) {
  return 6144 + cy * 32 + cx;
}

// ---------------------------------------------------------------------------
// 3. Render SCR to canvas
// ---------------------------------------------------------------------------

/**
 * Render a 6912-byte SCR dump onto a canvas element.
 * Sets canvas dimensions to 256x192 and draws every pixel.
 *
 * @param {Uint8Array} scrData  6912 bytes (pixel data + attributes)
 * @param {HTMLCanvasElement} canvas  target canvas
 */
export function renderSCR(scrData, canvas) {
  canvas.width = 256;
  canvas.height = 192;
  const ctx = canvas.getContext('2d');
  const imgData = renderSCRToImageData(scrData);
  ctx.putImageData(imgData, 0, 0);
}

// ---------------------------------------------------------------------------
// 4. Image → SCR quantizer
// ---------------------------------------------------------------------------

/**
 * Squared Euclidean distance between two RGB colors.
 * No sqrt needed — we only compare distances.
 *
 * @param {number} r1
 * @param {number} g1
 * @param {number} b1
 * @param {number} r2
 * @param {number} g2
 * @param {number} b2
 * @returns {number}
 */
export function colorDistance(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return dr * dr + dg * dg + db * db;
}

/**
 * Convert an ImageData (256x192 RGBA) into ZX Spectrum screen format.
 *
 * For each 8x8 cell, tries all valid ink/paper combinations (both bright
 * states, all 8x8 color pairs) and picks the one with least total squared
 * error.  For each combination, every pixel is assigned to whichever of
 * the two colors (ink or paper) is closer to the original.
 *
 * Optimization: when ink === paper the cell is a solid block (no need to
 * test per-pixel), and we skip the redundant (paper, ink) swap because
 * that just flips all pixel bits.
 *
 * @param {ImageData} imageData  256x192 RGBA image
 * @returns {{ scr: Uint8Array, tax: number }}
 *   scr — 6912-byte SCR dump
 *   tax — total quantization error (sum of squared distances)
 */
export function imageDataToSCR(imageData) {
  const src = imageData.data; // Uint8ClampedArray, 256*192*4 bytes
  const scr = new Uint8Array(6912);
  let totalTax = 0;

  // Pre-extract RGB values for the entire image into a flat array
  // for faster inner-loop access (avoids *4 multiply + alpha skip).
  const w = 256;
  const rgb = new Uint8Array(256 * 192 * 3);
  for (let i = 0, j = 0; i < src.length; i += 4, j += 3) {
    rgb[j]     = src[i];
    rgb[j + 1] = src[i + 1];
    rgb[j + 2] = src[i + 2];
  }

  // Iterate over 32x24 character cells
  for (let cy = 0; cy < 24; cy++) {
    for (let cx = 0; cx < 32; cx++) {

      // Collect the 64 RGB values for this cell
      const cellRGB = new Uint8Array(64 * 3); // 64 pixels * 3 channels
      for (let row = 0; row < 8; row++) {
        const sy = cy * 8 + row;
        for (let col = 0; col < 8; col++) {
          const sx = cx * 8 + col;
          const srcIdx = (sy * w + sx) * 3;
          const dstIdx = (row * 8 + col) * 3;
          cellRGB[dstIdx]     = rgb[srcIdx];
          cellRGB[dstIdx + 1] = rgb[srcIdx + 1];
          cellRGB[dstIdx + 2] = rgb[srcIdx + 2];
        }
      }

      // Find the best ink/paper/bright combination
      let bestError = Infinity;
      let bestAttr = 0;
      let bestPixels = new Uint8Array(8); // one byte per pixel row

      // Try both bright states
      for (let bright = 0; bright <= 1; bright++) {
        const palOffset = bright << 3; // 0 or 8

        // Try all ink/paper pairs.  To avoid testing both (ink, paper) and
        // (paper, ink) — which differ only by flipping all pixel bits —
        // we iterate paper <= ink.
        for (let ink = 0; ink < 8; ink++) {
          const inkR = PALETTE[palOffset + ink][0];
          const inkG = PALETTE[palOffset + ink][1];
          const inkB = PALETTE[palOffset + ink][2];

          for (let paper = 0; paper <= ink; paper++) {
            const paperR = PALETTE[palOffset + paper][0];
            const paperG = PALETTE[palOffset + paper][1];
            const paperB = PALETTE[palOffset + paper][2];

            let error = 0;
            const pixels = new Uint8Array(8);

            // For each pixel, decide ink (1) or paper (0)
            for (let row = 0; row < 8; row++) {
              let rowByte = 0;
              for (let col = 0; col < 8; col++) {
                const idx = (row * 8 + col) * 3;
                const pr = cellRGB[idx];
                const pg = cellRGB[idx + 1];
                const pb = cellRGB[idx + 2];

                const dInk   = colorDistance(pr, pg, pb, inkR, inkG, inkB);
                const dPaper = colorDistance(pr, pg, pb, paperR, paperG, paperB);

                if (dInk <= dPaper) {
                  // Pixel is ink (bit = 1). MSB = leftmost.
                  rowByte |= (0x80 >> col);
                  error += dInk;
                } else {
                  error += dPaper;
                }
              }
              pixels[row] = rowByte;

              // Early exit: if we already exceeded the best, stop
              if (error >= bestError) break;
            }

            if (error < bestError) {
              bestError = error;
              bestAttr = (bright << 6) | (paper << 3) | ink;
              bestPixels = pixels;
            }
            // Swapping ink/paper just inverts pixel bits — same visual,
            // same error.  No need to test the mirror case.
          }
        }
      }

      // Write pixel bytes into SCR at the correct interleaved addresses
      for (let row = 0; row < 8; row++) {
        const addr = pixelAddress(cx * 8, cy * 8 + row);
        scr[addr] = bestPixels[row];
      }

      // Write attribute byte
      scr[attrAddress(cx, cy)] = bestAttr;
      totalTax += bestError;
    }
  }

  return { scr, tax: totalTax };
}

// ---------------------------------------------------------------------------
// 5. Attribute filter (round-trip preview)
// ---------------------------------------------------------------------------

/**
 * Show what an image would look like on real Spectrum hardware.
 * Quantizes to SCR format and renders back.
 *
 * @param {ImageData} imageData  256x192 RGBA input
 * @returns {ImageData}  256x192 RGBA output (Spectrum-quantized)
 */
export function attributeFilter(imageData) {
  const { scr } = imageDataToSCR(imageData);
  return renderSCRToImageData(scr);
}

// ---------------------------------------------------------------------------
// 6. Render SCR to ImageData
// ---------------------------------------------------------------------------

/**
 * Decode a 6912-byte SCR dump into an ImageData (256x192 RGBA).
 * Useful for compositing or off-screen rendering.
 *
 * @param {Uint8Array} scrData  6912 bytes
 * @returns {ImageData}  256x192 RGBA
 */
export function renderSCRToImageData(scrData) {
  const imgData = new ImageData(256, 192);
  const pixels = imgData.data;

  for (let cy = 0; cy < 24; cy++) {
    for (let cx = 0; cx < 32; cx++) {
      // Read attribute for this cell
      const attr = scrData[attrAddress(cx, cy)];
      const bright = (attr >> 6) & 1;
      const paper  = (attr >> 3) & 7;
      const ink    = attr & 7;

      const palOffset = bright << 3;
      const inkColor   = PALETTE[palOffset + ink];
      const paperColor = PALETTE[palOffset + paper];

      // Decode 8 pixel rows
      for (let row = 0; row < 8; row++) {
        const y = cy * 8 + row;
        const addr = pixelAddress(cx * 8, y);
        const byte = scrData[addr];

        for (let col = 0; col < 8; col++) {
          const x = cx * 8 + col;
          // Bit 7 = leftmost pixel
          const isInk = (byte >> (7 - col)) & 1;
          const color = isInk ? inkColor : paperColor;

          const offset = (y * 256 + x) * 4;
          pixels[offset]     = color[0]; // R
          pixels[offset + 1] = color[1]; // G
          pixels[offset + 2] = color[2]; // B
          pixels[offset + 3] = 255;      // A
        }
      }
    }
  }

  return imgData;
}
