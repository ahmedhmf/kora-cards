export const GOOGLE_DRIVE_CONFIG = {
  // Create a Web OAuth client in Google Cloud Console and paste its client ID here.
  clientId: 'PASTE_YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com',

  // The app creates and reuses this folder in the signed-in usher's My Drive.
  folderName: 'KORA Event Uploads'
} as const;
