// Starting points for the LispBM editor. None of them drives a motor.

import { LISP_STARTER } from '../state/lisp'

export interface LispExample {
  id: string
  title: string
  hint: string
  code: string
}

export const LISP_EXAMPLES: LispExample[] = [
  { id: 'hello', title: 'Hello and battery voltage', hint: 'Prints a greeting, then the battery voltage every 5 s.', code: LISP_STARTER },
  {
    id: 'speed',
    title: 'Speed readout',
    hint: 'Prints the speed once a second.',
    code: `; Prints the speed once a second (metres per second; × 3.6 for km/h).
(loopwhile t
  (progn
    (print (str-from-n (get-speed) "Speed: %.1f m/s"))
    (sleep 1)))
`,
  },
  {
    id: 'temp',
    title: 'Temperature warning',
    hint: 'Warns in the console when the MOSFETs get hot.',
    code: `; Warns when the controller's MOSFETs pass a temperature.
(def warn-at 70) ; °C

(loopwhile t
  (progn
    (if (> (get-temp-fet) warn-at)
      (print (str-from-n (get-temp-fet) "MOSFETs hot: %.0f C")))
    (sleep 2)))
`,
  },
  {
    id: 'trip',
    title: 'Trip counter',
    hint: 'Keeps the top speed and battery sag in global variables, which show under Stats.',
    code: `; Records the top speed and the lowest battery voltage since the script started.
; Numeric globals like these show in the Stats panel.
(def top-speed 0)
(def low-volt 100)

(loopwhile t
  (progn
    (setq top-speed (max top-speed (get-speed)))
    (setq low-volt (min low-volt (get-vin)))
    (sleep 0.1)))
`,
  },
  {
    id: 'events',
    title: 'React to CAN messages',
    hint: 'Prints the CAN frames this controller receives, using an event handler.',
    code: `; Prints the raw CAN frames with extended ids that reach this controller.
; Uses LispBM's event handler, as in the VESC LispBM documentation.
(defun event-handler ()
  (loopwhile t
    (recv
      ((event-can-eid . ((? id) . (? data)))
        (print (list "CAN" id data)))
      (_ nil))))

(event-register-handler (spawn event-handler))
(event-enable 'event-can-eid)
`,
  },
]
