import { Injectable } from '@angular/core';
import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';
import { RatedPlayer } from '../data/fc27-players.data';
import type { CardDesign } from '../state/card.store';
import type { FacingMode } from './camera.service';

export interface CardData {
  name: string;
  position: string;
  number: number;
  design: CardDesign;
  match: RatedPlayer;
  facingMode?: FacingMode;
}

@Injectable({ providedIn: 'root' })
export class CardRendererService {
  private segmenter?: ImageSegmenter;
  private imageSegmenter?: ImageSegmenter;
  private frameId?: number;
  private busy = false;
  private brandLogo = new Image();
  private productBall = new Image();
  private cardThreeBallSprite = new Image();
  private cardOne = {
    background: new Image(),
    upperFill: new Image(),
    frame: new Image(),
    header: new Image(),
    nameBar: new Image(),
    portrait: new Image(),
    icons: new Image(),
  };
  private cardTwo = {
    background: new Image(),
    frame: new Image(),
    header: new Image(),
    nameBar: new Image(),
    portrait: new Image(),
    icons: new Image(),
  };
  private cardThree = {
    background: new Image(),
    frame: new Image(),
    header: new Image(),
    nameBar: new Image(),
    portrait: new Image(),
    footballIcon: new Image(),
    crownIcon: new Image(),
  };
  private cardFour = {
    background: new Image(),
    frame: new Image(),
    header: new Image(),
    nameBar: new Image(),
    portrait: new Image(),
    icons: new Image(),
  };
  private assetsLoaded = false;

  async start(video: HTMLVideoElement, canvas: HTMLCanvasElement, getData: () => CardData) {
    this.stop();
    await Promise.all([this.loadAssets(), this.loadSegmenter(), this.loadCanvasFonts()]);
    canvas.width = 1080;
    canvas.height = getData().design === 'mono-red' ? 1350 : 1920;
    if (video.readyState < 2)
      await new Promise<void>((resolve) => (video.onloadeddata = () => resolve()));
    await video.play();
    let latestPlayer: HTMLCanvasElement | undefined;
    const render = () => {
      if (!this.segmenter) return;
      if (!this.busy && video.readyState >= 2) {
        this.busy = true;
        this.segmenter.segmentForVideo(video, performance.now(), (result) => {
          const masks = result.confidenceMasks;
          if (masks?.length) {
            const mask = masks.length > 1 ? masks[1] : masks[0];
            const data = getData();
            const player = this.playerLayer(
              video,
              mask.getAsFloat32Array(),
              mask.width,
              mask.height,
              canvas.width,
              canvas.height,
              data.design,
              data.facingMode === 'user',
            );
            latestPlayer = player;
            masks.forEach((item) => item.close());
          }
          this.busy = false;
        });
      }
      // Redraw on every animation frame so canvas animations keep moving even
      // while MediaPipe is still processing the next segmentation frame.
      if (latestPlayer) this.compose(canvas, latestPlayer, getData());
      this.frameId = requestAnimationFrame(render);
    };
    render();
  }

  async renderImage(
    image: HTMLImageElement,
    canvas: HTMLCanvasElement,
    getData: () => CardData,
  ) {
    this.stop();
    await Promise.all([this.loadAssets(), this.loadImageSegmenter(), this.loadCanvasFonts()]);
    canvas.width = 1080;
    canvas.height = getData().design === 'mono-red' ? 1350 : 1920;
    const result = this.imageSegmenter!.segment(image);
    const masks = result.confidenceMasks;
    if (!masks?.length) throw new Error('No person mask was returned');
    const mask = masks.length > 1 ? masks[1] : masks[0];
    const player = this.playerLayer(
      image,
      mask.getAsFloat32Array(),
      mask.width,
      mask.height,
      canvas.width,
      canvas.height,
      getData().design,
      getData().facingMode === 'user',
    );
    masks.forEach((item) => item.close());
    const render = () => {
      this.compose(canvas, player, getData());
      this.frameId = requestAnimationFrame(render);
    };
    render();
  }

  stop() {
    if (this.frameId) cancelAnimationFrame(this.frameId);
    this.frameId = undefined;
    this.busy = false;
  }

  destroy() {
    this.stop();
    this.segmenter?.close();
    this.segmenter = undefined;
    this.imageSegmenter?.close();
    this.imageSegmenter = undefined;
  }

  private async loadSegmenter() {
    if (this.segmenter) return;
    const vision = await FilesetResolver.forVisionTasks('./mediapipe/wasm');
    this.segmenter = await ImageSegmenter.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    });
  }

  private async loadImageSegmenter() {
    if (this.imageSegmenter) return;
    const vision = await FilesetResolver.forVisionTasks('./mediapipe/wasm');
    this.imageSegmenter = await ImageSegmenter.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
        delegate: 'GPU',
      },
      runningMode: 'IMAGE',
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    });
  }

  private async loadCanvasFonts() {
    if (!document.fonts) return;
    await Promise.all([
      document.fonts.load('400 32px "Chakra Petch"'),
      document.fonts.load('500 32px "Chakra Petch"'),
      document.fonts.load('600 48px "Chakra Petch"'),
      document.fonts.load('700 64px "Chakra Petch"'),
      document.fonts.load('900 94px "Chakra Petch"'),
    ]);
  }

  private loadAssets() {
    if (this.assetsLoaded) return Promise.resolve();
    const load = (image: HTMLImageElement, src: string) =>
      new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error(`Artwork failed to load: ${src}`));
        image.src = src;
      });
    return Promise.all([
      load(this.brandLogo, './brand/kora-logo.png'),
      load(this.productBall, './brand/kora-ball.png'),
      load(this.cardThreeBallSprite, './brand/kora-ball-lens-sprite.png'),
      load(this.cardOne.background, './cards/card-1/bg.svg'),
      load(this.cardOne.upperFill, './cards/card-1/upper-fill.svg'),
      load(this.cardOne.frame, './cards/card-1/card-frame.svg'),
      load(this.cardOne.header, './cards/card-1/header.svg'),
      load(this.cardOne.nameBar, './cards/card-1/name-number.svg'),
      load(this.cardOne.portrait, './cards/card-1/pic-frame.svg'),
      load(this.cardOne.icons, './cards/card-1/top-icons.svg'),
      load(this.cardTwo.background, './cards/card-2/bg.svg'),
      load(this.cardTwo.frame, './cards/card-2/card-frame.svg'),
      load(this.cardTwo.header, './cards/card-2/header.svg'),
      load(this.cardTwo.nameBar, './cards/card-2/name-number.svg'),
      load(this.cardTwo.portrait, './cards/card-2/pic-frame.svg'),
      load(this.cardTwo.icons, './cards/card-2/icons.svg'),
      load(this.cardThree.background, './brand/360-2.103.gif'),
      load(this.cardThree.frame, './cards/card-3/card-frame.svg'),
      load(this.cardThree.header, './cards/card-3/header.svg'),
      load(this.cardThree.nameBar, './cards/card-3/name-number.svg'),
      load(this.cardThree.portrait, './cards/card-3/pic-frame.svg'),
      load(this.cardThree.footballIcon, './cards/card-3/football-icon.svg'),
      load(this.cardThree.crownIcon, './cards/card-3/crown-icon.svg'),
      load(this.cardFour.background, './cards/card-4/bg.svg'),
      load(this.cardFour.frame, './cards/card-4/card-frame.svg'),
      load(this.cardFour.header, './cards/card-4/header.svg'),
      load(this.cardFour.nameBar, './cards/card-4/name-number.svg'),
      load(this.cardFour.portrait, './cards/card-4/pic-frame.svg'),
      load(this.cardFour.icons, './cards/card-4/icons.svg'),
    ]).then(() => {
      this.assetsLoaded = true;
    });
  }

  private playerLayer(
    source: CanvasImageSource,
    values: Float32Array,
    mw: number,
    mh: number,
    w: number,
    h: number,
    design: CardDesign,
    mirror = true,
  ) {
    const mask = document.createElement('canvas');
    mask.width = mw;
    mask.height = mh;
    const maskContext = mask.getContext('2d')!;
    const pixels = maskContext.createImageData(mw, mh);
    for (let i = 0; i < values.length; i++) {
      const p = i * 4;
      const confidence = Math.max(0, Math.min(1, values[i]));
      const feathered = Math.max(0, Math.min(1, (confidence - 0.22) / 0.52));
      const alpha = feathered * feathered * (3 - 2 * feathered);
      pixels.data[p] = pixels.data[p + 1] = pixels.data[p + 2] = 255;
      pixels.data[p + 3] = Math.round(alpha * 255);
    }
    maskContext.putImageData(pixels, 0, 0);

    const output = document.createElement('canvas');
    output.width = w;
    output.height = h;
    const ctx = output.getContext('2d')!;
    const compact = design === 'mono-red';
    const x = compact ? 157 : 145;
    const y = compact ? 250 : 345;
    const playerWidth = compact ? 766 : 790;
    const playerHeight = compact ? 740 : 870;

    const sw = (source as HTMLVideoElement).videoWidth || (source as HTMLImageElement).naturalWidth || (source as HTMLCanvasElement).width || mw;
    const sh = (source as HTMLVideoElement).videoHeight || (source as HTMLImageElement).naturalHeight || (source as HTMLCanvasElement).height || mh;

    const targetRatio = playerWidth / playerHeight;
    const sourceRatio = sw / sh;

    let sWidth = sw;
    let sHeight = sh;
    let sx = 0;
    let sy = 0;

    if (sourceRatio > targetRatio) {
      sWidth = sh * targetRatio;
      sx = (sw - sWidth) / 2;
    } else {
      sHeight = sw / targetRatio;
      sy = (sh - sHeight) / 2;
    }

    if (mirror) {
      const mirroredX = w - x - playerWidth;
      ctx.save();
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(source, sx, sy, sWidth, sHeight, mirroredX, y, playerWidth, playerHeight);
      ctx.drawImage(mask, sx, sy, sWidth, sHeight, mirroredX, y, playerWidth, playerHeight);
      ctx.globalCompositeOperation = 'source-in';
      ctx.drawImage(source, sx, sy, sWidth, sHeight, mirroredX, y, playerWidth, playerHeight);
      ctx.restore();
    } else {
      ctx.drawImage(source, sx, sy, sWidth, sHeight, x, y, playerWidth, playerHeight);
      ctx.drawImage(mask, sx, sy, sWidth, sHeight, x, y, playerWidth, playerHeight);
      ctx.globalCompositeOperation = 'source-in';
      ctx.drawImage(source, sx, sy, sWidth, sHeight, x, y, playerWidth, playerHeight);
    }

    return output;
  }

  private compose(canvas: HTMLCanvasElement, player: HTMLCanvasElement, data: CardData) {
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (data.design === 'blue-gold') {
      this.drawExactCardOne(ctx, player, data);
      return;
    }
    if (data.design === 'red-black') {
      this.drawExactCardTwo(ctx, player, data);
      return;
    }
    if (data.design === 'white-red') {
      this.drawExactCardThree(ctx, player, data);
      return;
    }
    this.drawExactCardFour(ctx, player, data);
  }

  private drawExactCardOne(
    ctx: CanvasRenderingContext2D,
    player: HTMLCanvasElement,
    data: CardData,
  ) {
    const w = 1080;
    const h = 1920;
    ctx.drawImage(this.cardOne.background, 0, 0, w, h);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(this.cardOne.header, 126, 70, 828, 175);
    ctx.drawImage(this.cardOne.upperFill, 126, 300, 828, 1445);
    ctx.drawImage(this.cardOne.frame, 126, 300, 828, 1445);
    ctx.drawImage(this.cardOne.portrait, 145, 385, 790, 825);

    ctx.save();
    this.cardOnePortraitPath(ctx);
    ctx.clip();
    ctx.drawImage(player, 0, 0);
    ctx.restore();

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 5;
    ctx.drawImage(this.cardOne.icons, 120, 335, 840, 83);
    ctx.restore();
    this.cardOneRating(ctx, data.match.overall, data.position);
    ctx.drawImage(this.cardOne.nameBar, 145, 1190, 790, 121);

    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.font = '900 52px Chakra Petch';
    ctx.fillText((data.name || 'KORA STAR').toUpperCase(), 174, 1269, 610);
    ctx.textAlign = 'right';
    ctx.fillText(String(data.number), 905, 1269);

    this.cardOneStats(ctx, data);
    this.drawAnimatedBall(ctx, 365, 1582, 350);
  }

  private cardOnePortraitPath(ctx: CanvasRenderingContext2D) {
    ctx.beginPath();
    ctx.moveTo(145, 490);
    ctx.quadraticCurveTo(260, 490, 260, 385);
    ctx.quadraticCurveTo(540, 350, 820, 385);
    ctx.quadraticCurveTo(820, 490, 935, 490);
    ctx.lineTo(935, 1210);
    ctx.lineTo(145, 1210);
    ctx.closePath();
  }

  private cardOneStats(ctx: CanvasRenderingContext2D, data: CardData) {
    const stats = data.match.stats;
    ctx.strokeStyle = 'rgba(15,15,15,.72)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(555, 1345);
    ctx.lineTo(555, 1540);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '900 32px Chakra Petch';
    stats.forEach((stat, index) => {
      const y = 1390 + (index % 3) * 58;
      ctx.textAlign = 'left';
      if (index < 3) {
        ctx.font = '900 32px Chakra Petch';
        ctx.fillText(stat.label, 350, y);
        ctx.font = '500 30px Chakra Petch';
        ctx.fillText(String(stat.value), 470, y);
      } else {
        ctx.font = '500 30px Chakra Petch';
        ctx.fillText(String(stat.value), 600, y);
        ctx.font = '900 32px Chakra Petch';
        ctx.fillText(stat.label, 660, y);
      }
    });
  }

  private cardOneRating(
    ctx: CanvasRenderingContext2D,
    overall: number,
    position: string,
  ) {
    ctx.fillStyle = '#090909';
    ctx.textAlign = 'left';
    ctx.font = '900 126px Chakra Petch';
    ctx.fillText(String(overall), 215, 655);
    ctx.font = '700 68px Chakra Petch';
    ctx.fillText(position, 218, 733);
  }

  private drawExactCardTwo(
    ctx: CanvasRenderingContext2D,
    player: HTMLCanvasElement,
    data: CardData,
  ) {
    const w = 1080;
    const h = 1920;
    ctx.drawImage(this.cardTwo.background, 0, 0, w, h);
    ctx.drawImage(this.cardTwo.header, 126, 70, 828, 175);
    ctx.drawImage(this.cardTwo.frame, 126, 300, 828, 1445);
    ctx.drawImage(this.cardTwo.portrait, 145, 385, 790, 825);

    ctx.save();
    ctx.beginPath();
    ctx.rect(145, 385, 790, 825);
    ctx.clip();
    ctx.drawImage(player, 0, 0);
    ctx.restore();

    ctx.drawImage(this.cardTwo.icons, 171, 325, 738, 90);
    this.rating(ctx, data.match.overall, data.position, 184, 650, '#090909');
    ctx.fillStyle = '#090909';
    ctx.textAlign = 'right';
    ctx.font = '900 48px Chakra Petch';
    ctx.fillText(String(data.number), 905, 470);

    ctx.drawImage(this.cardTwo.nameBar, 145, 1190, 790, 121);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.font = '900 52px Chakra Petch';
    ctx.fillText((data.name || 'KORA STAR').toUpperCase(), 174, 1269, 610);
    ctx.textAlign = 'right';
    ctx.fillText(String(data.number), 905, 1269);

    this.cardTwoStats(ctx, data);
    ctx.drawImage(this.productBall, 365, 1582, 350, 350);
  }

  private cardTwoStats(ctx: CanvasRenderingContext2D, data: CardData) {
    const stats = data.match.stats;
    ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(540, 1370);
    ctx.lineTo(540, 1555);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '900 30px Chakra Petch';
    stats.forEach((stat, index) => {
      const x = index < 3 ? 320 : 580;
      const y = 1390 + (index % 3) * 62;
      ctx.textAlign = 'left';
      ctx.fillText(stat.label, x, y);
      ctx.font = '500 28px Chakra Petch';
      ctx.fillText(String(stat.value), x + 105, y);
      ctx.font = '900 30px Chakra Petch';
    });
  }

  private drawExactCardThree(
    ctx: CanvasRenderingContext2D,
    player: HTMLCanvasElement,
    data: CardData,
  ) {
    const w = 1080;
    const h = 1920;
    ctx.drawImage(this.cardThree.background, 0, 0, w, h);
    const bottomHalfHeight = h / 2;
    const animatedBallSize = Math.min(w, bottomHalfHeight);
    const animatedBallX = (w - animatedBallSize) / 2;
    const animatedBallY = h - animatedBallSize;
    this.drawAnimatedBall(ctx, animatedBallX, animatedBallY, animatedBallSize);
    ctx.drawImage(this.cardThree.header, 126, 70, 828, 175);
    ctx.drawImage(this.cardThree.frame, 126, 300, 828, 1445);
    ctx.drawImage(this.cardThree.portrait, 145, 385, 790, 825);

    ctx.save();
    this.cardOnePortraitPath(ctx);
    ctx.clip();
    ctx.drawImage(player, 0, 0);
    ctx.restore();

    const footballX = 115;
    const footballY = 315;
    const footballSize = 90;
    const crownWidth = 90;
    const crownHeight = 62;
    const crownRightPadding = 115;
    const crownX = 1080 - crownRightPadding - crownWidth;
    const crownY = 325;
    ctx.drawImage(this.cardThree.footballIcon, footballX, footballY, footballSize, footballSize);
    ctx.drawImage(this.cardThree.crownIcon, crownX, crownY, crownWidth, crownHeight);

    ctx.drawImage(this.cardThree.nameBar, 145, 1190, 790, 121);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.font = '900 52px Chakra Petch';
    ctx.fillText((data.name || 'KORA STAR').toUpperCase(), 174, 1269, 610);
    ctx.textAlign = 'right';
    ctx.fillText(String(data.number), 905, 1269);

    this.cardThreeStats(ctx, data);
    this.centeredRating(ctx, data.match.overall, data.position, 800, 1450);
  }

  // Canvas does not reliably advance GIF frames, so both cards draw the
  // matching 7x7 sprite sheet explicitly.
  private drawAnimatedBall(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
  ) {
    const sourceSize = 360;
    const frameCount = 49;
    const frameDurationMs = 42;
    const frame = Math.floor(performance.now() / frameDurationMs) % frameCount;
    const sourceX = (frame % 7) * sourceSize;
    const sourceY = Math.floor(frame / 7) * sourceSize;
    ctx.drawImage(
      this.cardThreeBallSprite,
      sourceX,
      sourceY,
      sourceSize,
      sourceSize,
      x,
      y,
      size,
      size,
    );
  }

  private cardThreeStats(ctx: CanvasRenderingContext2D, data: CardData) {
    const stats = data.match.stats;
    ctx.strokeStyle = 'rgba(15,15,15,.55)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(440, 1360);
    ctx.lineTo(440, 1580);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '900 29px Chakra Petch';
    stats.forEach((stat, index) => {
      const y = 1410 + (index % 3) * 62;
      ctx.textAlign = 'left';
      if (index < 3) {
        ctx.fillText(stat.label, 225, y);
        ctx.font = '500 27px Chakra Petch';
        ctx.fillText(String(stat.value), 335, y);
      } else {
        ctx.font = '500 27px Chakra Petch';
        ctx.fillText(String(stat.value), 475, y);
        ctx.font = '900 29px Chakra Petch';
        ctx.fillText(stat.label, 540, y);
      }
      ctx.font = '900 29px Chakra Petch';
    });
  }

  private centeredRating(
    ctx: CanvasRenderingContext2D,
    overall: number,
    position: string,
    centerX: number,
    y: number,
  ) {
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = '900 94px Chakra Petch';
    ctx.fillText(String(overall), centerX, y);
    ctx.font = '700 54px Chakra Petch';
    ctx.fillText(position, centerX, y + 64);
  }

  private drawExactCardFour(
    ctx: CanvasRenderingContext2D,
    player: HTMLCanvasElement,
    data: CardData,
  ) {
    ctx.drawImage(this.cardFour.background, 0, 0, 1080, 1350);
    ctx.drawImage(this.cardFour.frame, 138, 170, 804, 1140);
    ctx.drawImage(this.cardFour.header, 157, 55, 766, 117);
    ctx.drawImage(this.cardFour.portrait, 157, 250, 766, 722);

    ctx.save();
    ctx.beginPath();
    ctx.rect(157, 250, 766, 722);
    ctx.clip();
    ctx.drawImage(player, 0, 0);
    ctx.restore();

    ctx.drawImage(this.cardFour.icons, 147, 185, 786, 72);
    this.rating(ctx, data.match.overall, data.position, 190, 510, '#090909');
    ctx.fillStyle = '#090909';
    ctx.textAlign = 'right';
    ctx.font = '900 44px Chakra Petch';
    ctx.fillText(String(data.number), 900, 335);

    ctx.drawImage(this.cardFour.nameBar, 157, 915, 766, 117);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.font = '900 48px Chakra Petch';
    ctx.fillText((data.name || 'KORA STAR').toUpperCase(), 185, 990, 585);
    ctx.textAlign = 'right';
    ctx.fillText(String(data.number), 895, 990);

    this.cardFourStats(ctx, data);
  }

  private cardFourStats(ctx: CanvasRenderingContext2D, data: CardData) {
    ctx.strokeStyle = 'rgba(255,255,255,.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(540, 1070);
    ctx.lineTo(540, 1250);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '900 28px Chakra Petch';
    data.match.stats.forEach((stat, index) => {
      const x = index < 3 ? 315 : 580;
      const y = 1095 + (index % 3) * 58;
      ctx.textAlign = 'left';
      ctx.fillText(stat.label, x, y);
      ctx.font = '500 26px Chakra Petch';
      ctx.fillText(String(stat.value), x + 98, y);
      ctx.font = '900 28px Chakra Petch';
    });
  }

  private drawTextileBackground(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = '#090909';
    ctx.fillRect(0, 0, 1061, 1483);
    ctx.save();
    ctx.strokeStyle = '#ed1c24';
    ctx.globalAlpha = 0.78;
    ctx.lineWidth = 10;
    for (let x = -900; x < 1300; x += 36) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 900, 1483);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.26;
    ctx.lineWidth = 3;
    for (let y = 0; y < 1483; y += 18) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(1061, y - 300);
      ctx.stroke();
    }
    const shade = ctx.createLinearGradient(0, 0, 1061, 0);
    shade.addColorStop(0, 'rgba(0,0,0,.75)');
    shade.addColorStop(0.5, 'rgba(0,0,0,.05)');
    shade.addColorStop(1, 'rgba(0,0,0,.7)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, 1061, 1483);
    ctx.restore();
  }

  private drawTechnicalBackground(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = '#f5f5f2';
    ctx.fillRect(0, 0, 1061, 1483);
    ctx.save();
    ctx.globalAlpha = 0.13;
    ctx.filter = 'grayscale(1)';
    for (let y = 40; y < 1440; y += 300) {
      for (let x = -80; x < 1000; x += 390) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(-0.28);
        ctx.drawImage(this.brandLogo, 0, 0, 430, 90);
        ctx.restore();
      }
    }
    ctx.restore();
    ctx.strokeStyle = '#161616';
    ctx.lineWidth = 4;
    ctx.strokeRect(120, 175, 821, 1130);
  }

  private drawProductBackground(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 1061, 1483);
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.drawImage(this.productBall, -110, 610, 1280, 1280);
    ctx.restore();
  }

  private portraitPath(ctx: CanvasRenderingContext2D, design: CardDesign) {
    ctx.beginPath();
    if (design === 'red-black') {
      ctx.rect(135, 185, 790, 745);
      return;
    }
    ctx.moveTo(125, 270);
    ctx.quadraticCurveTo(220, 270, 220, 185);
    ctx.quadraticCurveTo(530, 130, 841, 185);
    ctx.quadraticCurveTo(841, 270, 936, 270);
    ctx.lineTo(936, 945);
    ctx.lineTo(125, 945);
    ctx.closePath();
  }

  private drawOverlay(ctx: CanvasRenderingContext2D, data: CardData) {
    const white = data.design === 'blue-gold';
    ctx.save();
    ctx.filter = white ? 'brightness(0) invert(1)' : 'brightness(0)';
    ctx.drawImage(this.brandLogo, 135, 55, 790, 150);
    ctx.restore();

    this.portraitPath(ctx, data.design);
    ctx.strokeStyle = data.design === 'blue-gold' ? '#fff' : '#111';
    ctx.lineWidth = 8;
    ctx.stroke();

    if (data.design === 'blue-gold') this.drawDesignOne(ctx, data);
    else if (data.design === 'red-black') this.drawDesignTwo(ctx, data);
    else this.drawDesignThree(ctx, data);
  }

  private drawDesignOne(ctx: CanvasRenderingContext2D, data: CardData) {
    this.topNumbers(ctx, data.number, '#fff');
    this.rating(ctx, data.match.overall, data.position, 160, 375, '#080808');
    this.nameBar(ctx, data.name, 125, 905, 811, 90, '#080808', '#fff');
    ctx.fillStyle = '#f3131c';
    ctx.beginPath();
    ctx.moveTo(125, 995);
    ctx.lineTo(936, 995);
    ctx.lineTo(936, 1285);
    ctx.quadraticCurveTo(530, 1385, 125, 1285);
    ctx.closePath();
    ctx.fill();
    this.stats(ctx, data, '#fff', 315, 1085);
    ctx.drawImage(this.productBall, 365, 1200, 330, 330);
  }

  private drawDesignTwo(ctx: CanvasRenderingContext2D, data: CardData) {
    this.topNumbers(ctx, data.number, '#111');
    this.rating(ctx, data.match.overall, data.position, 165, 385, '#111');
    this.nameBar(ctx, data.name, 135, 900, 790, 90, '#ed1c24', '#fff');
    ctx.fillStyle = '#080808';
    ctx.beginPath();
    ctx.moveTo(135, 990);
    ctx.lineTo(925, 990);
    ctx.lineTo(925, 1295);
    ctx.quadraticCurveTo(530, 1380, 135, 1295);
    ctx.closePath();
    ctx.fill();
    this.stats(ctx, data, '#fff', 315, 1085);
    ctx.drawImage(this.productBall, 370, 1205, 320, 320);
  }

  private drawDesignThree(ctx: CanvasRenderingContext2D, data: CardData) {
    this.topNumbers(ctx, data.number, '#111');
    this.nameBar(ctx, data.name, 125, 905, 811, 90, '#050505', '#fff');
    ctx.fillStyle = '#ed1c24';
    ctx.beginPath();
    ctx.moveTo(125, 995);
    ctx.lineTo(936, 995);
    ctx.lineTo(936, 1290);
    ctx.quadraticCurveTo(530, 1410, 125, 1290);
    ctx.closePath();
    ctx.fill();
    this.stats(ctx, data, '#fff', 275, 1090);
    this.rating(ctx, data.match.overall, data.position, 755, 1100, '#fff');
  }

  private topNumbers(ctx: CanvasRenderingContext2D, number: number, color: string) {
    ctx.fillStyle = color;
    ctx.font = '900 48px Chakra Petch';
    ctx.textAlign = 'left';
    ctx.fillText(String(number), 130, 245);
    ctx.textAlign = 'right';
    ctx.fillText(String(number), 931, 245);
  }

  private rating(
    ctx: CanvasRenderingContext2D,
    overall: number,
    position: string,
    x: number,
    y: number,
    color: string,
  ) {
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.font = '900 94px Chakra Petch';
    ctx.fillText(String(overall), x, y);
    ctx.font = '700 54px Chakra Petch';
    ctx.fillText(position, x + 5, y + 62);
  }

  private nameBar(
    ctx: CanvasRenderingContext2D,
    name: string,
    x: number,
    y: number,
    width: number,
    height: number,
    background: string,
    color: string,
  ) {
    ctx.fillStyle = background;
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.font = '900 48px Chakra Petch';
    ctx.fillText((name || 'KORA STAR').toUpperCase(), x + 28, y + 62, width - 150);
  }

  private stats(
    ctx: CanvasRenderingContext2D,
    data: CardData,
    color: string,
    dividerX: number,
    startY: number,
  ) {
    ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(dividerX, startY - 20);
    ctx.lineTo(dividerX, startY + 165);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = '800 29px Chakra Petch';
    data.match.stats.forEach((stat, index) => {
      const column = index < 3 ? dividerX - 180 : dividerX + 35;
      const row = index % 3;
      ctx.textAlign = 'left';
      ctx.fillText(stat.label, column, startY + row * 58);
      ctx.font = '500 26px Chakra Petch';
      ctx.fillText(String(stat.value), column + 92, startY + row * 58);
      ctx.font = '800 29px Chakra Petch';
    });
  }
}
