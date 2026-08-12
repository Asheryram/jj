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

/** FR-3.1 — the six categories, described once and reused everywhere. */
export const CATEGORY_META: Record<
  Category,
  { label: string; short: string; blurb: string; icon: (p: { className?: string }) => ReactNode; accent: string }
> = {
  data: {
    label: 'Data Bundles',
    short: 'Data',
    blurb: 'Non-expiry bundles for MTN, Telecel and AirtelTigo.',
    icon: DataIcon,
    accent: 'bg-brand-50 text-brand-700',
  },
  airtime: {
    label: 'Airtime',
    short: 'Airtime',
    blurb: 'Instant top-up on all three networks.',
    icon: PhoneIcon,
    accent: 'bg-teal-50 text-teal-700',
  },
  voice: {
    label: 'Voice Bundles',
    short: 'Voice',
    blurb: 'Talk-time minutes that last the month.',
    icon: VoiceIcon,
    accent: 'bg-violet-50 text-violet-700',
  },
  sms: {
    label: 'SMS Bundles',
    short: 'SMS',
    blurb: 'Bulk SMS packs for personal and business use.',
    icon: SmsIcon,
    // Not amber: too close to the brand's Golden Yellow, which means "act".
    accent: 'bg-cyan-50 text-cyan-700',
  },
  afa: {
    label: 'AFA Registration',
    short: 'AFA',
    blurb: 'MTN AFA SIM registration, handled for you.',
    icon: IdIcon,
    accent: 'bg-rose-50 text-rose-700',
  },
  checker: {
    label: 'Result Checkers',
    short: 'Checkers',
    blurb: 'BECE and WASSCE vouchers delivered instantly.',
    icon: CertificateIcon,
    accent: 'bg-emerald-50 text-emerald-700',
  },
}

export const CATEGORY_ORDER: Category[] = ['data', 'airtime', 'voice', 'sms', 'afa', 'checker']
