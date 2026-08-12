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
    accent: 'bg-sky-50 text-sky-700',
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
    accent: 'bg-amber-50 text-amber-700',
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
    accent: 'bg-teal-50 text-teal-700',
  },
}

export const CATEGORY_ORDER: Category[] = ['data', 'airtime', 'voice', 'sms', 'afa', 'checker']
