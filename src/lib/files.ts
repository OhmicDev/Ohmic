// Saving and opening files from the browser.

/** "SIM_75_100 · CAN 2" → "SIM_75_100_CAN_2" */
export function safeFileName(s: string): string {
  return s.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'file'
}

export function stamp(t = Date.now()): string {
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
}

export function downloadText(name: string, text: string, mime = 'application/xml') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Whether this browser can hand a file to the system share sheet (mostly phones). */
export function canShareFiles(): boolean {
  try {
    const probe = new File(['x'], 'x.xml', { type: 'application/xml' })
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] })
  } catch {
    return false
  }
}

/** Opens the share sheet with the file. Falls back to a download. */
export async function shareText(name: string, text: string, mime = 'application/xml'): Promise<void> {
  const file = new File([text], name, { type: mime })
  if (canShareFiles()) {
    try {
      await navigator.share({ files: [file], title: name })
      return
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return
    }
  }
  downloadText(name, text, mime)
}

/** Asks the user for a text file. Resolves null if they cancel. */
export function pickTextFile(accept = '.xml,application/xml,text/xml'): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = async () => {
      const f = input.files?.[0]
      resolve(f ? { name: f.name, text: await f.text() } : null)
    }
    input.addEventListener('cancel', () => resolve(null))
    input.click()
  })
}

/** Asks for one or more files, with their last-modified times. Resolves empty if cancelled. */
export function pickFiles(accept: string): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = true
    input.onchange = () => resolve([...(input.files ?? [])])
    input.addEventListener('cancel', () => resolve([]))
    input.click()
  })
}
