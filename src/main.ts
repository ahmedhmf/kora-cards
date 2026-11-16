import 'zone.js';
import { bootstrapApplication } from '@angular/platform-browser';
import { CardShellComponent } from './app/card-shell.component';
import { TvWallComponent } from './app/tv-wall.component';

// Keep the photo booth at '/', and dedicate '/wall' to the TV display.
// Do not initialise the camera/store services on the TV route.
const isTvWall=window.location.pathname.replace(/\/+$/,'')==='/wall';
bootstrapApplication(isTvWall?TvWallComponent:CardShellComponent).catch(console.error);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(error => {
      console.warn('Service worker registration was skipped:', error);
    });
  });
}
