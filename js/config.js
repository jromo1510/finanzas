/* Configuracion de la app. Lo unico que hay que editar despues de publicar el servidor. */
window.APP_CONFIG = {
  // URL de la Aplicacion web de Apps Script (Implementar > Administrar implementaciones).
  // Termina en /exec. Ejemplo: 'https://script.google.com/macros/s/AKfycb.../exec'
  API_URL: 'https://script.google.com/macros/s/AKfycbxEeK-_-pSrAq0Zrm-f0CZ27jTQ1MbnjbcPsdtKm-Rc3MrYsv7TV0OTuFLIjtZ7OMvP/exec',

  APP_NAME: 'Finanzas',
  CURRENCY: 'S/',
  LOCALE: 'es-PE',

  // Cada cuanto se revisa si la otra persona hizo cambios (solo con la app abierta).
  SYNC_INTERVAL_MS: 15000,

  // Subir este numero cada vez que publiques cambios en la app (fuerza la actualizacion).
  APP_VERSION: '1.0.0'
};
