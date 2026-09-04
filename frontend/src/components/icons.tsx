import type { SVGProps } from 'react'

/**
 * Hand-rolled inline icons. Zero dependencies keeps the bundle inside the
 * 3-second budget in NFR-1.1 — an icon font or a full icon package would be
 * the single largest asset on the storefront.
 */
type IconProps = SVGProps<SVGSVGElement>

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  )
}

export const HomeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
    <path d="M9.5 21v-6h5v6" />
  </Icon>
)

export const WalletIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.5" y="6" width="19" height="13" rx="2.5" />
    <path d="M2.5 10.5h19" />
    <circle cx="17" cy="14.8" r="1.1" fill="currentColor" stroke="none" />
  </Icon>
)

export const ReceiptIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 3h14v18l-2.3-1.6-2.35 1.6L12 19.4l-2.35 1.6L7.3 19.4 5 21Z" />
    <path d="M8.5 8h7M8.5 12h7M8.5 15.5h4" />
  </Icon>
)

export const TagIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20.5 13.3 13.3 20.5a2 2 0 0 1-2.8 0L3 13V3h10l7.5 7.5a2 2 0 0 1 0 2.8Z" />
    <circle cx="8" cy="8" r="1.6" />
  </Icon>
)

export const UsersIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="9" cy="8" r="3.4" />
    <path d="M2.8 20.5c0-3.4 2.8-5.6 6.2-5.6s6.2 2.2 6.2 5.6" />
    <path d="M16.5 5.4a3.4 3.4 0 0 1 0 6.6M18 15.3c2 .7 3.3 2.4 3.3 4.6" />
  </Icon>
)

export const ChartIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 20.5h17" />
    <path d="M6.5 20.5v-6M11 20.5V8M15.5 20.5v-8.5M20 20.5V4.5" />
  </Icon>
)

export const CashIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.5" y="6.5" width="19" height="11" rx="2" />
    <circle cx="12" cy="12" r="2.6" />
    <path d="M6 10v4M18 10v4" />
  </Icon>
)

export const SettingsIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3.1" />
    <path d="M12 2.8v2.4M12 18.8v2.4M4.5 7.5l2 1.2M17.5 15.3l2 1.2M4.5 16.5l2-1.2M17.5 8.7l2-1.2" />
  </Icon>
)

export const LogoutIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M15 4.5H19a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-4" />
    <path d="M10.5 8 7 12l3.5 4M7 12h9" />
  </Icon>
)

export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
  </Icon>
)

export const XIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
)

export const ChevronRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9.5 5.5 16 12l-6.5 6.5" />
  </Icon>
)

export const ChevronLeftIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14.5 5.5 8 12l6.5 6.5" />
  </Icon>
)

export const ChevronDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5.5 9.5 12 16l6.5-6.5" />
  </Icon>
)

export const CopyIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="8.5" y="8.5" width="12" height="12" rx="2" />
    <path d="M15.5 5.5A2 2 0 0 0 13.5 3.5h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2" />
  </Icon>
)

export const WhatsAppIcon = (p: IconProps) => (
  <Icon {...p} strokeWidth={1.6}>
    <path d="M20.5 11.6a8.5 8.5 0 0 1-12.6 7.5L3.5 20.5l1.5-4.3A8.5 8.5 0 1 1 20.5 11.6Z" />
    <path d="M8.9 8.6c.3-.6.6-.5.9-.5s.6.1.8.6l.5 1.2c.1.3 0 .5-.2.7l-.4.4a5.4 5.4 0 0 0 2.5 2.5l.4-.4c.2-.2.4-.3.7-.2l1.2.5c.5.2.6.5.6.8s.1.6-.5.9c-.5.3-1.4.6-2.5.2a8 8 0 0 1-4.3-4.3c-.4-1.1-.1-2 .3-2.4Z" />
  </Icon>
)

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M15.8 15.8 20.5 20.5" />
  </Icon>
)

export const DownloadIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5v11M8 11l4 3.5 4-3.5" />
    <path d="M4.5 18.5h15" />
  </Icon>
)

export const AlertIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5M12 16.4v.2" />
  </Icon>
)

export const ClockIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3.2 2" />
  </Icon>
)

export const DataIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 9.2a13.5 13.5 0 0 1 19 0" />
    <path d="M6 12.6a8.8 8.8 0 0 1 12 0" />
    <path d="M9.4 16a4.2 4.2 0 0 1 5.2 0" />
    <circle cx="12" cy="19.4" r="1.1" fill="currentColor" stroke="none" />
  </Icon>
)

export const PhoneIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
    <path d="M10.5 5.5h3" />
    <circle cx="12" cy="18" r="1" fill="currentColor" stroke="none" />
  </Icon>
)

export const VoiceIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="9" y="2.8" width="6" height="10.4" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3.2M9 21.2h6" />
  </Icon>
)

export const SmsIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20.5 12.5c0 3.8-3.8 6.9-8.5 6.9a10 10 0 0 1-2.2-.24L5 21.2l1-3.4a6.6 6.6 0 0 1-2.5-5.3c0-3.8 3.8-6.9 8.5-6.9s8.5 3.1 8.5 6.9Z" />
    <path d="M8.6 12.5h.02M12 12.5h.02M15.4 12.5h.02" />
  </Icon>
)

export const IdIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
    <circle cx="8.5" cy="11" r="2.1" />
    <path d="M5.2 16c.6-1.4 1.9-2.2 3.3-2.2s2.7.8 3.3 2.2M15 10h4M15 13.5h4" />
  </Icon>
)

export const CertificateIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 6.5 12 3l9 3.5-9 3.5Z" />
    <path d="M6.5 8.9v4.4c0 1.9 2.5 3.4 5.5 3.4s5.5-1.5 5.5-3.4V8.9" />
    <path d="M20.2 7.4v5.2M20.2 14.4v.2" />
  </Icon>
)

export const ShieldIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 2.8 20 5.6v6c0 4.4-3.3 8-8 9.6-4.7-1.6-8-5.2-8-9.6v-6Z" />
    <path d="M8.8 11.8l2.2 2.2 4.2-4.4" />
  </Icon>
)

export const MenuIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
)

export const TrendUpIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 16.5 9 11l3.5 3.5L20.5 6.5" />
    <path d="M15.5 6.5h5v5" />
  </Icon>
)

export const BanIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M6.4 17.6 17.6 6.4" />
  </Icon>
)

export const RefreshIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 12a8 8 0 1 1-2.6-5.9" />
    <path d="M20.5 4v4.2h-4.2" />
  </Icon>
)

export const StoreIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 9.5 5 4h14l1.5 5.5" />
    <path d="M4 9.5h16V20H4Z" />
    <path d="M9.5 20v-5h5v5" />
  </Icon>
)

export const SunIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4.5" />
    <path d="M12 2.5v2.5M12 19v2.5M4.5 12H2M22 12h-2.5M5.3 5.3l1.8 1.8M17 17l1.8 1.8M18.7 5.3 16.9 7M7 17l-1.8 1.8" />
  </Icon>
)

export const MoonIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 14.3A8.4 8.4 0 0 1 9.7 4a8.5 8.5 0 1 0 10.3 10.3Z" />
  </Icon>
)

export const GlobeIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.5 3.8 5.7 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.7-3.8-9S9.5 5.5 12 3Z" />
  </Icon>
)

export const HelpIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.2 9.2a2.8 2.8 0 1 1 4.3 2.4c-.9.6-1.5 1.1-1.5 2.2" />
    <path d="M12 17.2h.01" />
  </Icon>
)
