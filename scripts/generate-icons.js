/*
 * Generate Windows ICO and PNG from SVG
 * - Input: assets/database-icon.svg
 * - Output: assets/database-icon.ico, assets/database-icon.png (256x256)
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

async function main() {
  try {
    // Dynamically import ESM module
    const pngToIco = (await import('png-to-ico')).default;

    const assetsDir = path.join(process.cwd(), 'assets');
    const svgPath = path.join(assetsDir, 'database-icon.svg');

    if (!fs.existsSync(svgPath)) {
      console.error(`[generate-icons] SVG not found: ${svgPath}`);
      process.exit(1);
    }

    const sizes = [256, 128, 64, 48, 32, 24, 16];
    const tmpDir = path.join(process.cwd(), '.tmp-icons');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    console.log(`[generate-icons] Converting SVG -> PNG at sizes: ${sizes.join(', ')}`);
    const pngPaths = [];

    const svgBuffer = fs.readFileSync(svgPath);
    for (const size of sizes) {
      const pngOut = path.join(tmpDir, `database-icon-${size}.png`);
      await sharp(svgBuffer)
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png({ compressionLevel: 9 })
        .toFile(pngOut);
      pngPaths.push(pngOut);
    }

    // Write a top-level 256x256 PNG for fallback usage in Electron
    const png256Path = path.join(assetsDir, 'database-icon.png');
    await sharp(svgBuffer)
      .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toFile(png256Path);
    console.log(`[generate-icons] Wrote fallback PNG: ${png256Path}`);

    // Create ICO from multiple PNG sizes
    console.log('[generate-icons] Generating ICO from PNG sizes...');
    const icoBuffer = await pngToIco(pngPaths);
    const icoPath = path.join(assetsDir, 'database-icon.ico');
    fs.writeFileSync(icoPath, icoBuffer);
    console.log(`[generate-icons] Wrote ICO: ${icoPath}`);

    // Clean up temporary PNGs
    for (const p of pngPaths) {
      try { fs.unlinkSync(p); } catch (_) {}
    }
    try { fs.rmdirSync(tmpDir); } catch (_) {}

    console.log('[generate-icons] Done ✅');
  } catch (err) {
    console.error('[generate-icons] Failed:', err);
    process.exit(1);
  }
}

main();