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
    // Keep the player score and position, but do not paint a gray box
    // over the KORA template behind them.
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

  /**
   * Show the unprocessed camera image inside the inner portrait borders of
   * the real KORA card template. No AI, color key, or background removal.
   * This is a framing guide only; ORMBG runs on the full captured photo.
   */
  private drawLiveCardFrame(canvas: HTMLCanvasElement, video: HTMLVideoElement, data: CardData) {
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.drawImage(this.template, 0, 0, this.width, this.height);
    const sw = video.videoWidth, sh = video.videoHeight;
    if (sw && sh) {
      // The live view sits *inside* the white inner portrait border.
      // Preserve the template border above, below and along both sides.
      const slot = {x: 178, y: 353, width: 520, height: 501};
      const scale = Math.max(slot.width / sw, slot.height / sh);
      const w = sw * scale, h = sh * scale;
      const x = slot.x + (slot.width - w) / 2;
      const y = slot.y + (slot.height - h) / 2;
      ctx.save();
      // Chamfer ONLY the live-photo window's four corners, matching the
      // angular sports-card style. Do not clip the template or outer card.
      const cut = 22;
      const left = slot.x, top = slot.y;
      const right = slot.x + slot.width, bottom = slot.y + slot.height;
      ctx.beginPath();
      ctx.moveTo(left + cut, top);
      ctx.lineTo(right - cut, top);
      ctx.lineTo(right, top + cut);
      ctx.lineTo(right, bottom - cut);
      ctx.lineTo(right - cut, bottom);
      ctx.lineTo(left + cut, bottom);
      ctx.lineTo(left, bottom - cut);
      ctx.lineTo(left, top + cut);
      ctx.closePath();
      ctx.clip();
      if (data.facingMode === 'user') {
        ctx.translate(2 * x + w, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, x, y, w, h);
      ctx.restore();
    }
    // Place the same player name, number and stats on top of the preview.
    this.drawCardInformation(ctx, data);
  }

  async start(video: HTMLVideoElement, canvas: HTMLCanvasElement, getData: () => CardData) {
    // Template mode is still-photo only; legacy handles video.
    throw new Error('KORA photo cards support still images only.');
  }

  /** Lightweight native camera preview, drawn into the card 10 times/sec. */
  async startLivePreview(video: HTMLVideoElement, canvas: HTMLCanvasElement, getData: () => CardData) {
    this.stop();
    const generation = this.generation;
    await Promise.all([this.loadTemplate(), document.fonts?.ready ?? Promise.resolve()]);
    if (generation !== this.generation) return;
    canvas.width = this.width;
    canvas.height = this.height;
    let lastFrame = 0;
    const tick = (time: number) => {
      if (generation !== this.generation) return;
      if (video.readyState >= 2 && time - lastFrame >= 100) {
        lastFrame = time;
        this.drawLiveCardFrame(canvas, video, getData());
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
