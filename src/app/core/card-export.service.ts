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

  /**
   * Opens a print-only copy of the finished PNG, not the app's screen.
   * The system print dialog chooses the printer; a PWA cannot silently print.
   */
  printCard(canvas: HTMLCanvasElement): void {
    if (!canvas.width || !canvas.height) throw new Error('Card is not ready to print');
    // Open synchronously inside the shutter toolbar click to avoid popup blocking.
    const preview = window.open('', '_blank');
    if (!preview) throw new Error('Allow pop-ups to print your card, or save the image and print it from Photos.');
    try {
      const png = canvas.toDataURL('image/png');
      const doc = preview.document;
      doc.open();
      doc.write(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Print KORA Card</title><style>
  html,body{margin:0;background:#fff;color:#111;font-family:system-ui,sans-serif}
  .toolbar{padding:12px;text-align:center}
  button{font:600 16px system-ui,sans-serif;padding:12px 28px;cursor:pointer}
  .page{display:flex;align-items:center;justify-content:center;min-height:calc(100vh - 70px)}
  img{display:block;max-width:90vw;max-height:calc(100vh - 90px);width:auto;height:auto;object-fit:contain}
  @page{size:auto;margin:10mm}
  @media print{
    .toolbar{display:none}
    html,body{margin:0;background:#fff}
    .page{height:calc(100vh - 20mm);min-height:0;page-break-after:avoid}
    img{max-width:100%;max-height:100%;print-color-adjust:exact;-webkit-print-color-adjust:exact}
  }
</style></head>
<body><div class="toolbar"><button id="print-button" type="button">Print card</button></div>
<div class="page"><img id="print-image" alt="KORA player card" src="${png}"></div></body></html>`);
      doc.close();
      const print = () => { preview.focus(); preview.print(); };
      doc.getElementById('print-button')?.addEventListener('click', print);
      const image = doc.getElementById('print-image') as HTMLImageElement | null;
      if (image?.complete) preview.setTimeout(print, 100);
      else image?.addEventListener('load', () => preview.setTimeout(print, 100), {once:true});
    } catch (error) {
      preview.close();
      throw error;
    }
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
