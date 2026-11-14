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
  private cutout?: HTMLCanvasElement;
  private originalCutout?: HTMLCanvasElement;
  private output?: HTMLCanvasElement;
  private outputData?: CardData;
  private placement?: { x:number; y:number; width:number; height:number; sx:number; sy:number; sw:number; sh:number };

  eraseAt(cardX: number, cardY: number, radius = 30): void {
    const p = this.placement, cutout = this.cutout;
    if (!p || !cutout || !this.output || !this.outputData) return;
    if (cardX < 165 || cardX > 711 || cardY < 342 || cardY > 861) return;
    const px = p.sx + (cardX - p.x) / p.width * p.sw;
    const py = p.sy + (cardY - p.y) / p.height * p.sh;
    if (!Number.isFinite(px) || !Number.isFinite(py)) return;
    const rr = Math.max(4, Math.min(120, radius)) * p.sw / p.width;
    const ctx = cutout.getContext('2d')!;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath(); ctx.arc(px, py, rr, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    this.compose(this.output, cutout, this.outputData);
  }

  restoreCutout(): void {
    if (!this.originalCutout || !this.cutout || !this.output || !this.outputData) return;
    const ctx = this.cutout.getContext('2d')!;
    ctx.clearRect(0, 0, this.cutout.width, this.cutout.height);
    ctx.drawImage(this.originalCutout, 0, 0);
    this.compose(this.output, this.cutout, this.outputData);
  }

  private copyCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
    const result = document.createElement('canvas');
    result.width = source.width; result.height = source.height;
    result.getContext('2d')!.drawImage(source, 0, 0);
    return result;
  }

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
    const sw = photo ? media.naturalWidth : media.videoWidth;
    const sh = photo ? media.naturalHeight : media.videoHeight;
    if (!sw || !sh) throw new Error('Camera frame is not ready');
    // Preserve the whole photo and its context: tight pre-cropping makes
    // person extraction less reliable, particularly with selfies.
    const maxWidth = photo ? 1024 : 512;
    const maxHeight = photo ? 1536 : 768;
    const scale = Math.min(1, maxWidth / sw, maxHeight / sh);
    source.width = Math.max(1, Math.round(sw * scale));
    source.height = Math.max(1, Math.round(sh * scale));
    const ctx = source.getContext('2d')!;
    if (!photo && data.facingMode === 'user') {
      ctx.translate(source.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(media, 0, 0, source.width, source.height);
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

  private subjectBounds(person: HTMLCanvasElement) {
    const { width, height } = person;
    const data = person.getContext('2d', { willReadFrequently: true })!
      .getImageData(0, 0, width, height).data;
    let left = width, top = height, right = -1, bottom = -1;
    // An alpha threshold ignores stray translucent pixels outside the player.
    for (let y = 0; y < height; y += 3) {
      for (let x = 0; x < width; x += 3) {
        if (data[(y * width + x) * 4 + 3] < 100) continue;
        left = Math.min(left, x); top = Math.min(top, y);
        right = Math.max(right, x); bottom = Math.max(bottom, y);
      }
    }
    if (right < left || bottom < top) throw new Error('No player detected');
    const pad = 8;
    const x = Math.max(0, left - pad), y = Math.max(0, top - pad);
    return {
      x, y,
      width: Math.min(width - x, right - x + pad + 1),
      height: Math.min(height - y, bottom - y + pad + 1),
    };
  }

  private compose(canvas: HTMLCanvasElement, person: HTMLCanvasElement, data: CardData) {
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.drawImage(this.template, 0, 0, this.width, this.height);
    // Only the transparent person is placed over the white portrait panel.
    ctx.save();
    ctx.beginPath(); ctx.rect(165, 342, 546, 519); ctx.clip();
    // Position the actual extracted silhouette, not the complete source
    // photograph. This prevents close-up phone photos from being overzoomed.
    const bounds = this.placement
      ? { x: this.placement.sx, y: this.placement.sy, width: this.placement.sw, height: this.placement.sh }
      : this.subjectBounds(person);
    const targetWidth = 430;
    const targetHeight = 505;
    const scale = Math.min(targetWidth / bounds.width, targetHeight / bounds.height);
    const x = 495 - (bounds.width * scale) / 2;
    const y = 860 - bounds.height * scale;
    this.placement = { x, y, width: bounds.width * scale, height: bounds.height * scale,
      sx: bounds.x, sy: bounds.y, sw: bounds.width, sh: bounds.height };
    ctx.drawImage(person, bounds.x, bounds.y, bounds.width, bounds.height,
      x, y, bounds.width * scale, bounds.height * scale);
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
      if (generation === this.generation) {
        if (photo) {
          this.cutout = person;
          this.originalCutout = this.copyCanvas(person);
          this.output = canvas;
          this.outputData = getData();
          this.placement = undefined;
        }
        this.compose(canvas, person, getData());
      }
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
    this.cutout = undefined;
    this.originalCutout = undefined;
    this.output = undefined;
    this.outputData = undefined;
    this.placement = undefined;
  }

  destroy() {
    this.stop();
    this.segmenter?.close();
    this.segmenter = undefined;
    this.segmenterPromise = undefined;
    void this.quality.destroy();
  }
}
