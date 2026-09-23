import {Injectable} from '@angular/core';

@Injectable({providedIn:'root'})
export class CardExportService {
  createImageBlob(canvas: HTMLCanvasElement) {
    return new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Card export failed')), 'image/png')
    );
  }

  createVideoBlob(canvas: HTMLCanvasElement, duration = 4000) {
    return this.recordCanvas(canvas, duration);
  }

  private toBlob(canvas: HTMLCanvasElement) {
    return this.createImageBlob(canvas);
  }

  async share(canvas: HTMLCanvasElement, name: string, title = 'My Kora Card', text = 'My goal celebration! ⚽') {
    const blob = await this.toBlob(canvas);
    const filename = (name || 'star').toLowerCase().replace(/\s+/g, '-');
    const file = new File([blob], `kora-${filename}.png`, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title, text });
      return;
    }
    this.downloadBlob(blob, filename);
  }

  async download(canvas: HTMLCanvasElement, name: string) {
    this.downloadBlob(await this.toBlob(canvas), (name || 'star').toLowerCase().replace(/\s+/g, '-'));
  }

  async shareVideo(canvas: HTMLCanvasElement, name: string, title = 'My Kora Video', text = 'Created with KORA ⚽') {
    const blob = await this.recordCanvas(canvas);
    const extension = blob.type.includes('mp4') ? 'mp4' : 'webm';
    const filename = (name || 'moment').toLowerCase().replace(/\s+/g, '-');
    const file = new File([blob], `kora-${filename}.${extension}`, { type: blob.type });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title, text });
      return;
    }
    this.downloadVideoBlob(blob, filename, extension);
  }

  async downloadVideo(canvas: HTMLCanvasElement, name: string) {
    const blob = await this.recordCanvas(canvas);
    const extension = blob.type.includes('mp4') ? 'mp4' : 'webm';
    const filename = (name || 'moment').toLowerCase().replace(/\s+/g, '-');
    const file = new File([blob], `kora-${filename}.${extension}`, { type: blob.type });

    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Save Video' });
        return;
      } catch (err) {
        if ((err as DOMException).name === 'AbortError') return;
      }
    }
    this.downloadVideoBlob(blob, filename, extension);
  }

  private async recordCanvas(canvas: HTMLCanvasElement, duration = 4000) {
    if (!canvas.captureStream || typeof MediaRecorder === 'undefined') {
      throw new Error('Video export is not supported by this browser');
    }
    const stream = canvas.captureStream(30);
    const types = ['video/mp4;codecs=h264', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
    const type = types.find(item => MediaRecorder.isTypeSupported(item)) || '';
    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const parts: BlobPart[] = [];
    recorder.ondataavailable = event => {
      if (event.data.size) parts.push(event.data);
    };
    const stopped = new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve();
      recorder.onerror = () => reject(new Error('Video export failed'));
    });
    recorder.start(100);
    await new Promise(resolve => setTimeout(resolve, duration));
    recorder.stop();
    await stopped;
    stream.getTracks().forEach(track => track.stop());
    return new Blob(parts, { type: recorder.mimeType || type || 'video/webm' });
  }

  private downloadBlob(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `kora-${name}.png`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private downloadVideoBlob(blob: Blob, name: string, extension: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `kora-${name}.${extension}`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
