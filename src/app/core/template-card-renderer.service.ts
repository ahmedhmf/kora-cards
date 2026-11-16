import { Injectable, inject } from '@angular/core';
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
  private frameId?: number;
  private generation = 0;
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
    // Let the player's head project above the portrait panel border (reference card),
    // while stopping at the player-name strip below.
    ctx.beginPath(); ctx.rect(165, 250, 546, 611); ctx.clip();
    // Position the actual extracted silhouette, not the complete source
    // photograph. This prevents close-up phone photos from being overzoomed.
    const bounds = this.subjectBounds(person);
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
      // Use the SAME portrait window as final compose (including the area
      // above the inner white border). Fill it like a live photo-booth frame,
      // rather than shrinking the entire camera feed into the lower panel.
      // ORMBG still runs only after capture, so silhouette-specific sizing
      // cannot be identical without live subject detection.
      const slot = {x:165,y:250,width:546,height:611};
      // CSS object-fit:cover equivalent; preserve aspect ratio and crop excess.
      const scale = Math.max(slot.width / sw, slot.height / sh);
      const w = sw * scale, h = sh * scale;
      const x = slot.x + (slot.width - w) / 2;
      const y = slot.y + (slot.height - h) / 2;
      ctx.save();
      ctx.beginPath();ctx.rect(slot.x,slot.y,slot.width,slot.height);ctx.clip();
      if (data.facingMode === 'user') {
        ctx.translate(2*x+w,0);ctx.scale(-1,1);
      }
      ctx.drawImage(video,x,y,w,h);
      ctx.restore();
    }
    this.drawCardInformation(ctx,data);
  }

  async start(video: HTMLVideoElement, canvas: HTMLCanvasElement, getData: () => CardData) {
    // Template mode is still-photo only; legacy handles video.
    throw new Error('KORA photo cards support still images only.');
  }

  /**
   * Lightweight green-screen preview, with NO background-removal AI.
   * Only key out pixels when the corners indicate a green backdrop.
   * On ordinary backgrounds show raw camera video in the card instead.
   * The final photograph still uses high-quality ORMBG after capture.
   */
  async startLivePreview(video: HTMLVideoElement, canvas: HTMLCanvasElement, getData: () => CardData) {
    this.stop();
    const generation = this.generation;
    await Promise.all([this.loadTemplate(), document.fonts?.ready ?? Promise.resolve()]);
    if (generation !== this.generation) return;
    canvas.width = this.width;
    canvas.height = this.height;

    // Work with small frames; never run ORMBG/ONNX on the live camera.
    const sample = document.createElement('canvas');
    const sampleWidth = 256;
    let sampleCtx: CanvasRenderingContext2D | null = null;
    let lastPaint = 0;
    const isGreen = (r: number, g: number, b: number) =>
      g > 65 && g > r * 1.28 && g > b * 1.16;

    const tick = (time: number) => {
      if (generation !== this.generation) return;
      if (video.readyState >= 2 && time - lastPaint >= 130) {
        lastPaint = time;
        const data = getData();
        const sw = video.videoWidth, sh = video.videoHeight;
        if (sw && sh) {
          const w = sampleWidth, h = Math.max(1, Math.round(sh * w / sw));
          if (sample.width !== w || sample.height !== h) {
            sample.width = w;
            sample.height = h;
            sampleCtx = sample.getContext('2d', { willReadFrequently: true });
          }
          if (sampleCtx) {
            const ctx = sampleCtx;
            ctx.save();
            if (data.facingMode === 'user') {
              ctx.translate(w, 0);
              ctx.scale(-1, 1);
            }
            ctx.drawImage(video, 0, 0, w, h);
            ctx.restore();
            const pixels = ctx.getImageData(0, 0, w, h);
            const rgba = pixels.data;

            // Require a genuine green screen around the player. Otherwise
            // color keying would erase green clothing or random scenery.
            const offsets = [
              [0.04, 0.06], [0.96, 0.06], [0.04, 0.94], [0.96, 0.94],
              [0.04, 0.5], [0.96, 0.5],
            ];
            let greenCorners = 0;
            for (const [fx, fy] of offsets) {
              const x = Math.min(w - 1, Math.floor(fx * w));
              const y = Math.min(h - 1, Math.floor(fy * h));
              const i = (y * w + x) * 4;
              if (isGreen(rgba[i], rgba[i + 1], rgba[i + 2])) greenCorners++;
            }
            if (greenCorners >= 4) {
              for (let i = 0; i < rgba.length; i += 4) {
                const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
                // Softer edge around the key threshold minimizes halos.
                const dominance = Math.min(g / Math.max(1, r), g / Math.max(1, b));
                if (isGreen(r, g, b)) rgba[i + 3] = 0;
                else if (g > 60 && dominance > 1.1) {
                  rgba[i + 3] = Math.min(255, Math.round(255 * (1.28 - dominance) / 0.18));
                }
              }
              ctx.putImageData(pixels, 0, 0);
              try {
                this.compose(canvas, sample, data);
              } catch {
                this.drawLiveCardFrame(canvas, video, data);
              }
            } else {
              this.drawLiveCardFrame(canvas, video, data);
            }
          } else {
            this.drawLiveCardFrame(canvas, video, data);
          }
        }
      }
      this.frameId = requestAnimationFrame(tick);
    };
    this.frameId = requestAnimationFrame(tick);
  }

  async renderImage(image: HTMLImageElement, canvas: HTMLCanvasElement, getData: () => CardData) {
    this.stop();
    const generation = this.generation;
    await Promise.all([this.loadTemplate(), document.fonts?.ready ?? Promise.resolve()]);
    if (generation !== this.generation) return;
    const person = await this.quality.isolate(this.sourceCanvas(image, getData()));
    if (generation !== this.generation) return;
    canvas.width = this.width;
    canvas.height = this.height;
    this.compose(canvas, person, getData());
  }

  stop() {
    this.generation++;
    if (this.frameId !== undefined) cancelAnimationFrame(this.frameId);
    this.frameId = undefined;
  }

  destroy() {
    this.stop();
    void this.quality.destroy();
  }
}
