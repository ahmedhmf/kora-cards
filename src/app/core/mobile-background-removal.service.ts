import { Injectable } from '@angular/core';
import { env, pipeline } from '@huggingface/transformers';

/** Portrait-specific background matting. All inference stays on the phone. */
@Injectable({ providedIn: 'root' })
export class MobileBackgroundRemovalService {
  private remover?: Awaited<ReturnType<typeof pipeline<'background-removal'>>>;
  private pending?: Promise<Awaited<ReturnType<typeof pipeline<'background-removal'>>>>;

  private load() {
    if (this.remover) return Promise.resolve(this.remover);
    if (this.pending) return this.pending;
    env.useBrowserCache = true;
    this.pending = pipeline('background-removal', 'Xenova/modnet', {
      device: 'wasm',
      dtype: 'fp32',
    }).then(model => (this.remover = model)).catch(error => {
      this.pending = undefined;
      throw error;
    });
    return this.pending;
  }

  async isolate(source: HTMLCanvasElement): Promise<HTMLCanvasElement> {
    const model = await this.load();
    const results = await model([source.toDataURL('image/png')]);
    if (!results.length) throw new Error('Portrait AI returned no image');
    if (results[0].channels !== 4) throw new Error('Portrait AI did not produce an RGBA cutout');
    const foreground = await results[0].toCanvas();
    const result = document.createElement('canvas');
    result.width = source.width;
    result.height = source.height;
    const ctx = result.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(foreground, 0, 0, result.width, result.height);

    // Guard against model outputs which still contain an opaque photograph.
    // Never present the wall/background as if it were a successful player cutout.
    const sample = ctx.getImageData(0, 0, result.width, result.height).data;
    let backgroundPixels = 0;
    let foregroundPixels = 0;
    let edgeSamples = 0;
    let opaqueEdges = 0;
    const step = 8;
    for (let y = 0; y < result.height; y += step) {
      for (let x = 0; x < result.width; x += step) {
        const alpha = sample[(y * result.width + x) * 4 + 3];
        if (alpha < 32) backgroundPixels++;
        if (alpha > 220) foregroundPixels++;
        if (x < result.width * .08 || x > result.width * .92 || y < result.height * .06) {
          edgeSamples++;
          if (alpha > 240) opaqueEdges++;
        }
      }
    }
    const count = Math.ceil(result.width / step) * Math.ceil(result.height / step);
    console.info('[KORA portrait matting]', { model: 'Xenova/modnet', width: result.width, height: result.height,
      transparentPercent: Math.round(100 * backgroundPixels / count), opaquePercent: Math.round(100 * foregroundPixels / count) });
    if (backgroundPixels < count * .035 || foregroundPixels < count * .015 ||
        (edgeSamples > 0 && opaqueEdges / edgeSamples > .92)) {
      throw new Error('Portrait AI did not isolate the person. Please try a brighter photo with space around the head and shoulders.');
    }
    this.removeDetachedSpecks(ctx, result.width, result.height);
    return result;
  }

  /** Conservative cleanup only: connected chairs are deliberately NOT cut automatically. */
  private removeDetachedSpecks(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const image = ctx.getImageData(0, 0, width, height);
    const pixels = image.data;
    // Work on a reduced-resolution occupancy grid to cap memory on mobile.
    const step = 3, cols = Math.ceil(width / step), rows = Math.ceil(height / step);
    const occupied = new Uint8Array(cols * rows);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const px = Math.min(width - 1, x * step), py = Math.min(height - 1, y * step);
        occupied[y * cols + x] = pixels[(py * width + px) * 4 + 3] >= 100 ? 1 : 0;
      }
    }
    const labels = new Int32Array(occupied.length);
    const queue = new Int32Array(occupied.length);
    const sizes = [0];
    let label = 0;
    for (let start = 0; start < occupied.length; start++) {
      if (!occupied[start] || labels[start]) continue;
      label++; let head = 0, tail = 0;
      labels[start] = label; queue[tail++] = start;
      while (head < tail) {
        const pos = queue[head++], x = pos % cols, y = Math.floor(pos / cols);
        const neighbors = [x > 0 ? pos - 1 : -1, x + 1 < cols ? pos + 1 : -1,
          y > 0 ? pos - cols : -1, y + 1 < rows ? pos + cols : -1];
        for (const next of neighbors) {
          if (next >= 0 && occupied[next] && !labels[next]) {
            labels[next] = label; queue[tail++] = next;
          }
        }
      }
      sizes[label] = tail;
    }
    let largest = 0;
    for (const size of sizes) largest = Math.max(largest, size);
    // Remove only tiny disconnected high-confidence islands, not secondary limbs/hair.
    const minSize = Math.min(100, Math.max(8, Math.round(largest * .0015)));
    const erase = new Uint8Array(labels.length);
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] && sizes[labels[i]] < minSize) erase[i] = 1;
    }
    // Avoid modifying transparent anti-aliasing around the main silhouette:
    // only remove specks that are not adjacent to a retained component.
    for (let y = 0; y < height; y++) {
      const gy = Math.min(rows - 1, Math.floor(y / step));
      for (let x = 0; x < width; x++) {
        const gx = Math.min(cols - 1, Math.floor(x / step));
        if (!erase[gy * cols + gx]) continue;
        let nearMain = false;
        for (let oy = -1; oy <= 1 && !nearMain; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const nx = gx + ox, ny = gy + oy;
            if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
            const id = labels[ny * cols + nx];
            if (id && sizes[id] >= minSize) { nearMain = true; break; }
          }
        }
        if (!nearMain) pixels[(y * width + x) * 4 + 3] = 0;
      }
    }
    ctx.putImageData(image, 0, 0);
  }

  async destroy() {
    const remover = this.remover;
    this.remover = undefined;
    this.pending = undefined;
    await remover?.dispose();
  }
}
