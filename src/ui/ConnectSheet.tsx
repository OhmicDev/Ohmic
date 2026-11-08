import { useRouterState } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { ConnectPanel } from '../pages/ConnectPage'
import { autoConnect, useConnectSheet } from '../state/autoConnect'
import { useSession } from '../state/session'
import { useSettings } from '../state/settings'
import { Dialog } from './Dialog'

export const CONNECT_SHEET_TITLE = 'Connect your controller'

/**
 * The Connect sheet. Like VESC Tool, it comes up by itself when the app opens without a
 * connection (after the first-run intro), and reconnects the last device where it can.
 * It closes once connected.
 */
export function ConnectSheet() {
  const open = useConnectSheet((s) => s.open)
  const hide = useConnectSheet((s) => s.hide)
  const connected = useSession((s) => s.status === 'connected')
  const onboarded = useSettings((s) => s.onboarded)
  const path = useRouterState({ select: (s) => s.location.pathname })
  const onConnectPage = path === '/connect'
  const started = useRef(false)

  useEffect(() => {
    if (started.current || !onboarded) return
    started.current = true
    if (!useSettings.getState().autoConnect || useSession.getState().status !== 'idle') return
    // The Connect page shows the same choices; no sheet on top of it.
    if (!onConnectPage) useConnectSheet.getState().show()
    void autoConnect()
  }, [onboarded, onConnectPage])

  useEffect(() => {
    if (connected && useConnectSheet.getState().open) hide()
  }, [connected, hide])

  // Going to the Connect page swaps the sheet for the page, without giving up on the last device.
  useEffect(() => {
    if (onConnectPage && useConnectSheet.getState().open) useConnectSheet.setState({ open: false })
  }, [onConnectPage])

  return (
    <Dialog
      open={open && !onConnectPage}
      onClose={hide}
      size="sm"
      title={CONNECT_SHEET_TITLE}
      subtitle="Bluetooth or USB. Ohmic remembers it for next time."
    >
      <ConnectPanel />
    </Dialog>
  )
}
