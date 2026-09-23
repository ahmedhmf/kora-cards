import 'zone.js';
import { bootstrapApplication } from '@angular/platform-browser';
import { CardShellComponent } from './app/card-shell.component';

bootstrapApplication(CardShellComponent).catch(console.error);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(error => {
      console.warn('Service worker registration was skipped:', error);
    });
  });
}
