// English: the source catalog. Other languages translate these keys; anything they
// leave out falls back to the English text. {name} marks a value filled in at runtime.

export const en = {
  'nav.ride': 'Ride',
  'nav.setup': 'Setup',
  'nav.live': 'Live',
  'nav.tune': 'Tune',
  'nav.more': 'More',
  'nav.main': 'Main',
  'shell.home': '{app} home',
  'shell.skip': 'Skip to content',

  'pwa.updateReady': 'A new version of Ohmic is ready.',
  'pwa.updateHint': 'Reload when you’re not writing to a controller.',
  'pwa.reload': 'Reload',
  'pwa.later': 'Later',
  'pwa.offlineReady': 'Ohmic now works offline.',
  'pwa.offline': 'You’re offline. Everything works except firmware downloads; packages show the list from your last visit.',
  'pwa.offlineFirmware': 'Downloading firmware needs an internet connection. You’re offline; a firmware file you already have still works.',

  'settings.theme': 'Theme',
  'settings.theme.system': 'Automatic',
  'settings.theme.dark': 'Dark',
  'settings.theme.light': 'Light',
  'settings.language': 'Language',
  'settings.languageHint': 'More languages can be added; see the README.',
  'settings.data': 'Your data',
  'settings.data.hint': 'Settings backups, ride logs, ride modes and app settings, in one file. Use it to move to another device or browser.',
  'settings.data.export': 'Export everything',
  'settings.data.import': 'Import a file',
  'settings.developer': 'Developer',
  'settings.protocolLog': 'Protocol log',
  'settings.protocolLog.hint': 'Keeps the last {count} packets to and from the controller, for bug reports.',
  'settings.protocolLog.open': 'Open the log',
  'settings.intro': 'Show the intro again',

  'intro.skip': 'Skip',
  'intro.back': 'Back',
  'intro.next': 'Next',
  'intro.done': 'Get started',
  'intro.step': 'Step {n} of {total}',
  'intro.1.title': 'Welcome to Ohmic',
  'intro.1.body':
    'Ohmic sets up, monitors and tunes electric vehicles that run on VESC-based motor controllers: scooters, boards, bikes. It runs in your browser and works offline.',
  'intro.1.credit': 'Ohmic is an independent app. It speaks the open VESC protocol and builds on the work of the VESC project (vesc-project.com).',
  'intro.2.title': 'Connect',
  'intro.2.usb': 'USB cable: Chrome, Edge or Opera on a computer.',
  'intro.2.ble': 'Bluetooth: VESC Express or a VESC Bluetooth module (the NRF dongle), in Chrome, Edge, Opera or Samsung Internet.',
  'intro.2.phone': 'On a phone: Chrome or Samsung Internet on Android. On iPhone, use the free Bluefy browser; Safari can’t use Bluetooth.',
  'intro.2.setup': 'New build or new parts? Once connected, the Setup tab walks you through motor detection, throttle and brake, direction and battery.',
  'intro.3.title': 'Safe by design',
  'intro.3.check': 'Every setting is checked before it’s written. You see exactly what changes, and a backup is made first.',
  'intro.3.moving': 'Nothing is written, and no firmware is installed, while a wheel turns.',
  'intro.3.motor': 'Motor tests run only while you hold the button, and stop the moment you let go.',
} as const

export type MessageKey = keyof typeof en
