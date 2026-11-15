import { Injectable } from '@angular/core';
import { env, pipeline } from '@huggingface/transformers';

/** On-device ORMBG background removal for photo-only KORA cards. */
@Injectable({ providedIn: 'root' })
export class MobileBackgroundRemovalService {
  private remover?: Awaited<ReturnType<typeof pipeline<'background-removal'>>>;
  private pending?: Promise<Awaited<ReturnType<typeof pipeline<'background-removal'>>>>;

  private load() {
    if (this.remover) return Promise.resolve(this.remover);
    if (this.pending) return this.pending;
    env.useBrowserCache = true;
    this.pending = pipeline<'background-removal'>('background-removal', 'Orangebot/ormbg-ONNX', {
      device: 'wasm',
      dtype: 'uint8',
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
    console.info('[KORA portrait matting]', { model: 'Orangebot/ormbg-ONNX', width: result.width, height: result.height,
      transparentPercent: Math.round(100 * backgroundPixels / count), opaquePercent: Math.round(100 * foregroundPixels / count) });
    if (backgroundPixels < count * .035 || foregroundPixels < count * .015 ||
        (edgeSamples > 0 && opaqueEdges / edgeSamples > .92)) {
      throw new Error('Portrait AI did not isolate the person. Please try a brighter photo with space around the head and shoulders.');
    }
    // Keep the model's raw alpha: mask-island cleanup can delete sleeves/arms.
    return result;
  }

  async destroy() {
    const remover = this.remover;
    this.remover = undefined;
    this.pending = undefined;
    await remover?.dispose();
  }
}
