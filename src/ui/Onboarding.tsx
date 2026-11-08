import { useNavigate } from '@tanstack/react-router'
import { Bluetooth, Gauge, Hand, ShieldCheck, Usb, Wind, Wrench } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useT } from '../i18n'
import { useSession } from '../state/session'
import { useSettings } from '../state/settings'
import { Dialog } from './Dialog'
import { Logo } from './Logo'
import { Button } from './Primitives'

const STEPS = 3

/** The first-run intro: what Ohmic is, how to connect, and how it keeps writes safe. */
export function Onboarding() {
  const onboarded = useSettings((s) => s.onboarded)
  const setOnboarded = useSettings((s) => s.setOnboarded)
  const [step, setStep] = useState(1)
  const t = useT()
  const navigate = useNavigate()
  const done = () => {
    setOnboarded(true)
    setStep(1)
  }
  const demo = () => {
    done()
    void navigate({ to: '/connect' })
    void useSession.getState().connectDemo()
  }

  return (
    <Dialog
      open={!onboarded}
      onClose={done}
      size="sm"
      title={
        <span className="flex items-center gap-2.5">
          <Logo size={26} />
          {t(`intro.${step}.title` as 'intro.1.title')}
        </span>
      }
      subtitle={t('intro.step', { n: step, total: STEPS })}
      footer={
        <>
          {step === 1 ? (
            <Button variant="ghost" onClick={done}>
              {t('intro.skip')}
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => setStep(step - 1)}>
              {t('intro.back')}
            </Button>
          )}
          {step === 2 && <Button onClick={demo}>{t('intro.demo')}</Button>}
          {step < STEPS ? (
            <Button variant="primary" onClick={() => setStep(step + 1)}>
              {t('intro.next')}
            </Button>
          ) : (
            <Button variant="primary" onClick={done}>
              {t('intro.done')}
            </Button>
          )}
        </>
      }
    >
      <div className="min-h-44 text-sm text-muted" aria-live="polite">
        {step === 1 && (
          <div className="space-y-3">
            <p className="text-text">{t('intro.1.body')}</p>
            <p>{t('intro.1.credit')}</p>
          </div>
        )}
        {step === 2 && (
          <ul className="space-y-3">
            <Item icon={<Usb className="size-4" />}>{t('intro.2.usb')}</Item>
            <Item icon={<Bluetooth className="size-4" />}>{t('intro.2.ble')}</Item>
            <Item icon={<Gauge className="size-4" />}>{t('intro.2.demo')}</Item>
            <Item icon={<Wrench className="size-4" />}>{t('intro.2.setup')}</Item>
          </ul>
        )}
        {step === 3 && (
          <ul className="space-y-3">
            <Item icon={<ShieldCheck className="size-4" />}>{t('intro.3.check')}</Item>
            <Item icon={<Wind className="size-4" />}>{t('intro.3.moving')}</Item>
            <Item icon={<Hand className="size-4" />}>{t('intro.3.motor')}</Item>
          </ul>
        )}
      </div>
      <div className="mt-4 flex justify-center gap-1.5" aria-hidden>
        {Array.from({ length: STEPS }, (_, i) => (
          <span key={i} className={`h-1.5 rounded-full transition-all ${i + 1 === step ? 'w-5 bg-accent' : 'w-1.5 bg-line-strong'}`} />
        ))}
      </div>
    </Dialog>
  )
}

function Item({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent">{icon}</span>
      <span className="pt-1">{children}</span>
    </li>
  )
}
