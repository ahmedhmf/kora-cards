import { Injectable, inject } from '@angular/core';
import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';
import { MobileBackgroundRemovalService } from './mobile-background-removal.service';
import type { CardData } from './card-renderer.service';

/** Separate from the original CardRendererService: one template, one player cutout. */
@Injectable({ providedIn: 'root' })
export class TemplateCardRendererService {
  private readonly quality = inject(MobileBackgroundRemovalService);
  private readonly width = 877;
  private readonly height = 1558;
  private template = new Image();
  private templatePromise?: Promise<void>;
  private segmenter?: ImageSegmenter;
  private segmenterPromise?: Promise<ImageSegmenter>;
  private frameId?: number;
  private generation = 0;
  private busy = false;
  private lastFrame = 0;

  private loadTemplate(): Promise<void> {
    if (!this.templatePromise) {
      this.templatePromise = new Promise<void>((resolve, reject) => {
        this.template.onload = () => resolve();
        this.template.onerror = () => reject(new Error('Missing KORA card PNG: /cards/kora-red-black-template.png'));
        this.template.src = './cards/kora-red-black-template.png';
      }).catch(error => {
        this.templatePromise = undefined;
        throw error;
      });
    }
    return this.templatePromise;
  }

  private async loadSegmenter(): Promise<ImageSegmenter> {
    if (this.segmenter) return this.segmenter;
    if (!this.segmenterPromise) {
      this.segmenterPromise = (async () => {
        const files = await FilesetResolver.forVisionTasks('./mediapipe/wasm');
        const base = { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite' };
        const config = { runningMode: 'VIDEO' as const, outputCategoryMask: false, outputConfidenceMasks: true };
        try {
          return this.segmenter = await ImageSegmenter.createFromOptions(files, { ...config, baseOptions: { ...base, delegate: 'GPU' } });
        } catch {
          return this.segmenter = await ImageSegmenter.createFromOptions(files, { ...config, baseOptions: { ...base, delegate: 'CPU' } });
        }
      })().catch(error => { this.segmenterPromise = undefined; throw error; });
    }
    return this.segmenterPromise;
  }

  private sourceCanvas(media: HTMLVideoElement | HTMLImageElement, data: CardData): HTMLCanvasElement {
    const photo = media instanceof HTMLImageElement;
    const source = document.createElement('canvas');
    source.width = photo ? 1024 : 512;
    source.height = photo ? 1536 : 768;
    const sw = photo ? media.naturalWidth : media.videoWidth;
    const sh = photo ? media.naturalHeight : media.videoHeight;
    if (!sw || !sh) throw new Error('Camera frame is not ready');
    const scale = Math.min(sw / source.width, sh / source.height);
    const cropW = source.width * scale, cropH = source.height * scale;
    const ctx = source.getContext('2d')!;
    if (data.facingMode === 'user') {
      ctx.translate(source.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(media, (sw - cropW) / 2, (sh - cropH) / 2, cropW, cropH, 0, 0, source.width, source.height);
    return source;
  }

  private async segment(source: HTMLCanvasElement, time: number): Promise<HTMLCanvasElement> {
    const segmenter = await this.loadSegmenter();
    return new Promise((resolve, reject) => {
      segmenter.segmentForVideo(source, time, result => {
        try {
          const mask = result.confidenceMasks?.[1] ?? result.confidenceMasks?.[0];
          if (!mask) throw new Error('No person detected');
          const weights = mask.getAsFloat32Array();
          const alpha = document.createElement('canvas');
          alpha.width = mask.width; alpha.height = mask.height;
          const mctx = alpha.getContext('2d')!;
          const pixels = mctx.createImageData(alpha.width, alpha.height);
          for (let i = 0; i < weights.length; i++) {
            const x = Math.max(0, Math.min(1, (weights[i] - .16) / .66));
            const smooth = x * x * (3 - 2 * x);
            pixels.data[i * 4] = pixels.data[i * 4 + 1] = pixels.data[i * 4 + 2] = 255;
            pixels.data[i * 4 + 3] = Math.round(smooth * 255);
          }
          mctx.putImageData(pixels, 0, 0);
          const person = document.createElement('canvas');
          person.width = source.width; person.height = source.height;
          const ctx = person.getContext('2d')!;
          ctx.drawImage(alpha, 0, 0, person.width, person.height);
          ctx.globalCompositeOperation = 'source-in';
          ctx.drawImage(source, 0, 0);
          resolve(person);
        } catch (e) { reject(e); }
        finally { result.confidenceMasks?.forEach(m => m.close()); }
      });
    });
  }

  private compose(canvas: HTMLCanvasElement, person: HTMLCanvasElement, data: CardData) {
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.drawImage(this.template, 0, 0, this.width, this.height);
    // Only the transparent person is placed over the white portrait panel.
    ctx.save();
    ctx.beginPath(); ctx.rect(165, 342, 546, 519); ctx.clip();
    ctx.drawImage(person, 265, 270, 457, 610);
    ctx.restore();

    ctx.fillStyle = '#eeedf1';
    ctx.fillRect(193, 474, 155, 174);
    ctx.fillStyle = '#000';
    ctx.textAlign = 'left';
    ctx.font = '900 88px "Chakra Petch", sans-serif';
    ctx.fillText(String(data.match.overall), 198, 568, 165);
    ctx.font = '900 51px "Chakra Petch", sans-serif';
    ctx.fillText(data.position, 200, 637, 150);

    ctx.fillStyle = '#000'; ctx.fillRect(168, 862, 542, 82);
    ctx.fillStyle = '#fff'; ctx.font = '900 38px "Chakra Petch", sans-serif';
    ctx.fillText((data.name.trim() || 'KORA STAR').toUpperCase(), 188, 916, 415);
    ctx.textAlign = 'right'; ctx.font = '900 34px "Chakra Petch", sans-serif';
    ctx.fillText(String(data.number).padStart(2, '0'), 664, 916, 75);

    ctx.textAlign = 'left';
    const stats = data.match.stats;
    for (let i = 0; i < Math.min(3, stats.length); i++) {
      const y = 1028 + 48 * i;
      ctx.font = '700 29px "Chakra Petch", sans-serif';
      ctx.fillText(stats[i].label, 260, y, 76);
      ctx.fillText(String(stats[i].value), 360, y, 52);
    }
    for (let i = 3; i < Math.min(6, stats.length); i++) {
      const y = 1028 + 48 * (i - 3);
      ctx.font = '700 29px "Chakra Petch", sans-serif';
      ctx.fillText(String(stats[i].value), 490, y, 52);
      ctx.fillText(stats[i].label, 560, y, 76);
    }
  }

  private async renderCutout(media: HTMLVideoElement | HTMLImageElement, canvas: HTMLCanvasElement, getData: () => CardData, generation: number, time: number, photo: boolean) {
    if (this.busy) return;
    this.busy = true;
    try {
      const data = getData();
      const source = this.sourceCanvas(media, data);
      let person: HTMLCanvasElement;
      if (photo) {
        // Fail visibly rather than secretly producing a lower-quality cutout.
        person = await this.quality.isolate(source);
      } else {
        person = await this.segment(source, time);
      }
      if (generation === this.generation) this.compose(canvas, person, getData());
    } catch (e) {
      console.error('KORA player cutout failed', e);
      // Never present the original background as a successful cutout.
      if (photo) throw e;
    } finally {
      if (generation === this.generation) this.busy = false;
    }
  }

  async start(video: HTMLVideoElement, canvas: HTMLCanvasElement, getData: () => CardData) {
    // Template mode is still-photo only; legacy handles video.
    throw new Error('The new KORA template supports photos only. Select Classic Cards for video.');
  }

  private async oldVideoRenderer(video: HTMLVideoElement, canvas: HTMLCanvasElement, getData: () => CardData) {
    this.stop();
    const generation = this.generation;
    await Promise.all([this.loadTemplate(), this.loadSegmenter(), document.fonts?.ready ?? Promise.resolve()]);
    if (generation !== this.generation) return;
    canvas.width = this.width; canvas.height = this.height;
    const tick = (time: number) => {
      if (generation !== this.generation) return;
      if (video.readyState >= 2 && !this.busy && time - this.lastFrame >= 100) {
        this.lastFrame = time;
        void this.renderCutout(video, canvas, getData, generation, time, false);
      }
      this.frameId = requestAnimationFrame(tick);
    };
    this.frameId = requestAnimationFrame(tick);
  }

  async startLivePreview(_video: HTMLVideoElement, _canvas: HTMLCanvasElement, _getData: () => CardData) {
    // Live preview is the raw camera feed; heavy AI runs only after taking a photo.
  }

  async renderImage(image: HTMLImageElement, canvas: HTMLCanvasElement, getData: () => CardData) {
    this.stop();
    const generation = this.generation;
    await Promise.all([this.loadTemplate(), document.fonts?.ready ?? Promise.resolve()]);
    if (generation !== this.generation) return;
    canvas.width = this.width; canvas.height = this.height;
    await this.renderCutout(image, canvas, getData, generation, performance.now(), true);
  }

  stop() {
    this.generation++;
    if (this.frameId !== undefined) cancelAnimationFrame(this.frameId);
    this.frameId = undefined;
    this.busy = false;
    this.lastFrame = 0;
  }

  destroy() {
    this.stop();
    this.segmenter?.close();
    this.segmenter = undefined;
    this.segmenterPromise = undefined;
    void this.quality.destroy();
  }
}
