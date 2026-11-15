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
  private previewBounds?: {x:number;y:number;width:number;height:number};
  private lastSegmentationTime = -1;
  private lastPreviewWarning = 0;
  private alignedFrames = 0;

  /** The mask is used only to guide camera framing; ORMBG remains the still-photo model. */
  private framingAdvice(bounds: {x:number;y:number;width:number;height:number}, width:number, height:number): string {
    const left = bounds.x / width;
    const right = (bounds.x + bounds.width) / width;
    const top = bounds.y / height;
    const relativeWidth = bounds.width / width;
    const relativeHeight = bounds.height / height;
    const center = (left + right) / 2;
    if (top < .035) return 'Move back — keep your whole head visible';
    if (top > .28 || relativeHeight < .43 || relativeWidth < .23) return 'Move closer to the camera';
    if (relativeWidth > .87 || relativeHeight > .97 || left < .025 || right > .975) return 'Move back — keep your arms in frame';
    if (center < .39) return 'Move slightly right';
    if (center > .61) return 'Move slightly left';
    return '';
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

  private compose(canvas: HTMLCanvasElement, person: HTMLCanvasElement, data: CardData, boundsOverride?: {x:number;y:number;width:number;height:number}) {
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.drawImage(this.template, 0, 0, this.width, this.height);
    // Only the transparent person is placed over the white portrait panel.
    ctx.save();
    // Let the player's head project above the portrait panel border (reference card),
    // while stopping at the player-name strip below.
    ctx.beginPath(); ctx.rect(165, 250, 546, 611); ctx.clip();
    // Position the actual extracted silhouette, not the complete source
    // photograph. This prevents close-up phone photos from being overzoomed.
    const bounds = boundsOverride ?? this.subjectBounds(person);
    // Photo booth portrait: prioritize a recognizably large face and upper body.
    // Wide cutouts may crop at the left/right of the player window, like a sports
    // portrait; never crop the top of the head merely to fill the frame.
    const desiredWidth = 490;
    const desiredHeight = 585;
    const maximumWidth = 680;
    const maximumHeight = 605;
    const scale = Math.min(
      Math.max(desiredWidth / bounds.width, desiredHeight / bounds.height),
      maximumWidth / bounds.width,
      maximumHeight / bounds.height,
    );
    const x = 495 - (bounds.width * scale) / 2;
    const y = 858 - bounds.height * scale;
    ctx.drawImage(person, bounds.x, bounds.y, bounds.width, bounds.height,
      x, y, bounds.width * scale, bounds.height * scale);
    ctx.restore();

    this.drawCardInformation(ctx, data);
  }

  private drawCardInformation(ctx: CanvasRenderingContext2D, data: CardData) {
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

  private drawLiveCardFrame(canvas: HTMLCanvasElement, video: HTMLVideoElement, data: CardData) {
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.drawImage(this.template, 0, 0, this.width, this.height);
    const sw = video.videoWidth, sh = video.videoHeight;
    if (sw && sh) {
      // Show the whole camera image INSIDE the card window. This never
      // artificially zooms the camera; opaque surroundings are only a preview.
      const slot = {x:165,y:342,width:546,height:519};
      const scale = Math.min(slot.width / sw, slot.height / sh);
      const w = sw * scale, h = sh * scale;
      const x = slot.x + (slot.width - w) / 2;
      const y = slot.y + slot.height - h;
      ctx.save();
      ctx.beginPath(); ctx.rect(slot.x,slot.y,slot.width,slot.height); ctx.clip();
      if (data.facingMode === 'user') {
        ctx.translate(2*x+w,0); ctx.scale(-1,1);
      }
      ctx.drawImage(video,x,y,w,h);
      ctx.restore();
    }
    this.drawCardInformation(ctx,data);
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

  async startLivePreview(video: HTMLVideoElement, canvas: HTMLCanvasElement, getData: () => CardData, onFraming?: (state: 'checking' | 'adjust' | 'ready' | 'unavailable', hint: string) => void) {
    this.stop();
    const generation = this.generation;
    onFraming?.('checking', 'Finding player…');
    // Draw the card immediately. If the lightweight model isn't ready,
    // keep the raw framed view until segmentation becomes available.
    await Promise.all([this.loadTemplate(), document.fonts?.ready ?? Promise.resolve()]);
    if (generation !== this.generation) return;
    canvas.width = this.width;
    canvas.height = this.height;
    if (video.readyState >= 2) this.drawLiveCardFrame(canvas, video, getData());

    let segmenterReady = false;
    void this.loadSegmenter().then(() => {
      if (generation === this.generation) segmenterReady = true;
    }).catch(error => {
      console.warn('KORA live segmentation unavailable; retaining camera framing guide', error);
      if (generation === this.generation) onFraming?.('unavailable', 'Position guide unavailable — photo still works');
    });

    const paint = (time: number) => {
      if (generation !== this.generation) return;
      // 7–8 AI frames/second is a practical starting point for a phone PWA;
      // never overlap inference requests.
      if (video.readyState >= 2 && !this.busy && time - this.lastFrame >= 140) {
        this.lastFrame = time;
        if (!segmenterReady) {
          this.drawLiveCardFrame(canvas, video, getData());
        } else {
          this.busy = true;
          const data = getData();
          try {
            const source = this.sourceCanvas(video, data);
            // MediaPipe VIDEO timestamps must increase strictly, including
            // across camera restarts and reused segmenter instances.
            const stamp = Math.max(time, this.lastSegmentationTime + 1);
            this.lastSegmentationTime = stamp;
            void this.segment(source, stamp).then(person => {
              if (generation !== this.generation) return;
              const next = this.subjectBounds(person);
              const prev = this.previewBounds;
              // Smooth noisy silhouettes to prevent jumping on live preview.
              const blend = (previous: number, current: number) => previous * .65 + current * .35;
              const bounds = prev ? {
                x: blend(prev.x, next.x), y: blend(prev.y, next.y),
                width: blend(prev.width, next.width),
                height: blend(prev.height, next.height),
              } : next;
              this.previewBounds = bounds;
              const advice = this.framingAdvice(next, source.width, source.height);
              this.alignedFrames = advice ? 0 : Math.min(4, this.alignedFrames + 1);
              onFraming?.(advice ? 'adjust' : this.alignedFrames >= 3 ? 'ready' : 'checking',
                advice || (this.alignedFrames >= 3 ? 'Perfect position — take your photo!' : 'Hold still…'));
              this.compose(canvas, person, getData(), bounds);
            }).catch(error => {
              if (generation !== this.generation) return;
              if (time - this.lastPreviewWarning > 5000) {
                console.warn('Live person preview skipped; retaining camera guide', error);
                this.lastPreviewWarning = time;
              }
              this.drawLiveCardFrame(canvas, video, getData());
            }).finally(() => {
              if (generation === this.generation) this.busy = false;
            });
          } catch (error) {
            if (time - this.lastPreviewWarning > 5000) {
              console.warn('Live preview could not process frame', error);
              this.lastPreviewWarning = time;
            }
            this.drawLiveCardFrame(canvas, video, getData());
            this.busy = false;
          }
        }
      }
      this.frameId = requestAnimationFrame(paint);
    };
    this.frameId = requestAnimationFrame(paint);
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
    this.previewBounds = undefined;
    this.alignedFrames = 0;
    this.lastPreviewWarning = 0;
    // Preserve the last MediaPipe timestamp across preview restarts.
  }

  destroy() {
    this.stop();
    this.segmenter?.close();
    this.segmenter = undefined;
    this.segmenterPromise = undefined;
    void this.quality.destroy();
  }
}
