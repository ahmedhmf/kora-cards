import { Injectable } from '@angular/core';
import { env, pipeline } from '@huggingface/transformers';

/** High-quality still-photo background removal. Inference stays on the phone. */
@Injectable({ providedIn: 'root' })
export class MobileBackgroundRemovalService {
  private remover?: Awaited<ReturnType<typeof pipeline<'background-removal'>>>;
  private pending?: Promise<Awaited<ReturnType<typeof pipeline<'background-removal'>>>>;

  private load() {
    if (this.remover) return Promise.resolve(this.remover);
    if (this.pending) return this.pending;
    env.useBrowserCache = true;
    this.pending = pipeline('background-removal', 'Orangebot/ormbg-ONNX', {
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
    if (!results.length) throw new Error('Background-removal model returned no image');
    const foreground = await results[0].toCanvas();
    const result = document.createElement('canvas');
    result.width = source.width;
    result.height = source.height;
    result.getContext('2d')!.drawImage(foreground, 0, 0, result.width, result.height);
    return result;
  }

  async destroy() {
    const remover = this.remover;
    this.remover = undefined;
    this.pending = undefined;
    await remover?.dispose();
  }
}
