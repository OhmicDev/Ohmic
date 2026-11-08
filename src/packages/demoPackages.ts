// Two made-up packages for the demo scooter, so installing, removing and package
// settings can be tried without the official archive. They are labelled as demo
// packages everywhere and only offered on the demo connection.

import { packLispProgram } from '../protocol/lisp'
import { DEMO_CONFIG_MARKER } from '../sim/demoPackageConfig'
import type { PackageEntry } from '../state/packages'

const SPEED_CODE = `; Demo package: prints the speed once a second.
(print "Speed readout started")

(loopwhile t
  (progn
    (print (str-from-n (get-speed) "Speed: %.1f m/s"))
    (sleep 1)))
`

const LIGHTS_CODE = `${DEMO_CONFIG_MARKER}
; Demo package: a headlight controller with its own settings page.
(print "Lights package started")
(def light-level 80)
`

const LIGHTS_QML = `import QtQuick 2.15
import QtQuick.Controls 2.15

Item {
    Text { text: "Lights" }
}
`

export function demoPackages(): PackageEntry[] {
  return [
    {
      id: 'demo:speed',
      source: 'demo',
      pkg: {
        name: 'Speed readout (demo)',
        description: '',
        descriptionMd: 'Made up for the demo scooter. A script that prints the speed in the LispBM console once a second.',
        lispData: packLispProgram(SPEED_CODE),
        qmlFile: null,
        qmlFullscreen: false,
        isLibrary: false,
      },
    },
    {
      id: 'demo:lights',
      source: 'demo',
      pkg: {
        name: 'Lights (demo)',
        description: '',
        descriptionMd:
          'Made up for the demo scooter. A headlight controller with a settings page (mode, brightness, auto-on speed) and a QML screen, like many real packages.',
        lispData: packLispProgram(LIGHTS_CODE),
        qmlFile: LIGHTS_QML,
        qmlFullscreen: false,
        isLibrary: false,
      },
    },
  ]
}
