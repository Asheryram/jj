import type { ReactNode } from 'react'
import type { Category } from '../data/types'
import {
  CertificateIcon,
  DataIcon,
  IdIcon,
  PhoneIcon,
  SmsIcon,
  VoiceIcon,
} from './icons'

/** FR-3.1, every category, described once and reused everywhere. */
export const CATEGORY_META: Record<
  Category,
  { label: string; short: string; blurb: string; icon: (p: { className?: string }) => ReactNode; accent: string }
> = {
  data: {
    label: 'Data Bundles',
    short: 'Data',
    blurb: 'Non-expiry bundles for MTN, Telecel and AirtelTigo.',
    icon: DataIcon,
    accent: 'bg-brand-50 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300',
  },
  airtime: {
    label: 'Airtime',
    short: 'Airtime',
    blurb: 'Instant top-up on all three networks.',
    icon: PhoneIcon,
    accent: 'bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-400',
  },
  voice: {
    label: 'Voice Bundles',
    short: 'Voice',
    blurb: 'Talk-time minutes that last the month.',
    icon: VoiceIcon,
    accent: 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-400',
  },
  sms: {
    label: 'SMS Bundles',
    short: 'SMS',
    blurb: 'Bulk SMS packs for personal and business use.',
    icon: SmsIcon,
    // Not amber: too close to the brand's Golden Yellow, which means "act".
    accent: 'bg-cyan-50 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-400',
  },
  afa: {
    label: 'AFA Registration',
    short: 'AFA',
    blurb: 'MTN AFA SIM registration, handled for you.',
    icon: IdIcon,
    accent: 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400',
  },
  checker: {
    label: 'Result Checkers',
    short: 'Checkers',
    blurb: 'BECE and WASSCE vouchers delivered on screen and by SMS.',
    icon: CertificateIcon,
    accent: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400',
  },
  mashup: {
    label: 'MTN Mashup',
    short: 'Mashup',
    blurb: 'Data, minutes and SMS together in one MTN pack.',
    icon: VoiceIcon,
    accent: 'bg-yellow-50 dark:bg-yellow-950/40 text-yellow-800 dark:text-yellow-300',
  },
}

export const CATEGORY_ORDER: Category[] = ['data', 'mashup', 'airtime', 'voice', 'sms', 'afa', 'checker']
