import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { router } from './router'
import { startPwa } from './state/pwa'
// Starts reading controller settings whenever a connection comes up.
import './state/config'
import './state/faults'
// Keeps ride modes out of the settings editor and out of writes.
import './state/rideModes'
import './state/terminal'
// Developer option: records traffic when turned on in Settings.
import './state/protocolLog'

void startPwa()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
