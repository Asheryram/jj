import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, type TeamMember } from '../../lib/api'
import { useStore } from '../../state/store'
import { dateTime } from '../../lib/format'
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHead,
  CopyField,
  Field,
  Modal,
  PageHead,
  Spinner,
  TableWrap,
  Td,
  TextInput,
  Th,
} from '../../components/ui'
import { AlertIcon, CheckIcon, ShieldIcon, UsersIcon } from '../../components/icons'

/**
 * Who has the keys to the platform. Superadmin only.
 *
 * The point of this screen is that no password is ever handed over. Creating an
 * admin mints a one-time link; the new admin follows it and chooses their own
 * password, which nobody here ever learns. The alternative — the seed creating an
 * admin with a password published in `.env.example` — is a live credential in
 * production that cannot be rotated without a deploy.
 *
 * The link is emailed when mail is working, and shown here either way — a copy
 * rescues the case where it lands in spam. The modal reports which happened
 * rather than assuming, because assuming is how somebody ends up hand-delivering
 * a link that already arrived.
 */
export default function Team() {
  const { pushToast } = useStore()
  const [rows, setRows] = useState<TeamMember[] | null>(null)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [issued, setIssued] = useState<{
    email: string
    link: string
    purpose: string
    emailed: boolean
    emailProblem: string | null
  } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setRows(await api.team())
      setError('')
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'We could not load the team.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const resend = async (member: TeamMember) => {
    setBusyId(member.id)
    try {
      const result = await api.resendTeamLink(member.id)
      setIssued({
        email: result.email,
        link: result.setupLink,
        purpose: result.purpose,
        emailed: result.emailed,
        emailProblem: result.emailProblem,
      })
      await load()
    } catch (caught) {
      pushToast({
        tone: 'error',
        title: caught instanceof ApiError ? caught.message : 'We could not create a link.',
      })
    } finally {
      setBusyId(null)
    }
  }

  const setStatus = async (member: TeamMember, suspend: boolean) => {
    setBusyId(member.id)
    try {
      await (suspend ? api.suspendTeamMember(member.id) : api.restoreTeamMember(member.id))
      await load()
      pushToast({
        tone: suspend ? 'info' : 'success',
        title: `${member.email} ${suspend ? 'suspended' : 'restored'}`,
      })
    } catch (caught) {
      pushToast({
        tone: 'error',
        title: caught instanceof ApiError ? caught.message : 'We could not change that.',
      })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <PageHead
        title="Platform team"
        subtitle="Who can run the business on this platform. You never see or choose their password."
      />

      {error && (
        <Callout tone="danger" className="mt-3" icon={<AlertIcon className="size-4" />}>
          {error}
        </Callout>
      )}

      <Card className="mt-3">
        <CardHead
          title="Accounts with platform access"
          action={
            <Button size="sm" onClick={() => setAdding(true)}>
              Add an admin
            </Button>
          }
        />
        <div className="p-4 sm:p-5">
          {rows === null ? (
            <div className="py-8 text-center">
              <Spinner className="mx-auto size-6 text-brand-600 dark:text-brand-300" />
            </div>
          ) : (
            <TableWrap caption="Platform accounts">
              <thead>
                <tr>
                  <Th>Who</Th>
                  <Th>Role</Th>
                  <Th>State</Th>
                  <Th align="right" />
                </tr>
              </thead>
              <tbody>
                {rows.map((member) => (
                  <tr key={member.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                    <Td>
                      <p className="font-medium text-slate-900 dark:text-slate-50">{member.name}</p>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{member.email}</p>
                    </Td>
                    <Td>
                      <Badge tone={member.role === 'superadmin' ? 'brand' : 'neutral'}>
                        {member.role === 'superadmin' ? (
                          <>
                            <ShieldIcon className="size-3.5" /> superadmin
                          </>
                        ) : (
                          'admin'
                        )}
                      </Badge>
                    </Td>
                    <Td>
                      {member.status !== 'active' ? (
                        <Badge tone="danger">suspended</Badge>
                      ) : member.pendingSetup ? (
                        <Badge tone="warning">awaiting password</Badge>
                      ) : (
                        <Badge tone="success">active</Badge>
                      )}
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        added {dateTime(member.joinedAt)}
                      </p>
                    </Td>
                    <Td align="right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          loading={busyId === member.id}
                          onClick={() => void resend(member)}
                        >
                          {member.pendingSetup ? 'New setup link' : 'Reset link'}
                        </Button>
                        {member.status === 'active' ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === member.id}
                            onClick={() => void setStatus(member, true)}
                          >
                            Suspend
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === member.id}
                            onClick={() => void setStatus(member, false)}
                          >
                            Restore
                          </Button>
                        )}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </div>
      </Card>

      <Callout tone="info" className="mt-3" icon={<UsersIcon className="size-4" />}>
        A reset link is the only way back in for somebody locked out. Anyone with an account can
        also request one themselves from the sign-in page — it goes to their email, so it reaches
        them and nobody else.
      </Callout>

      <AddAdminModal
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={async (result) => {
          /**
           * Two different outcomes, and only one of them involves a link.
           *
           * An address that already has an account gains a *profile*: same person,
           * same password, reachable from the switcher. There is no link to pass
           * on, and showing the link modal with an empty value would invite
           * somebody to send nothing.
           */
          if (result.addedToExistingAccount || !result.setupLink) {
            pushToast({
              tone: 'success',
              title: 'Admin profile added to that account',
              detail:
                `${result.email} already had an account, so no new password is needed. ` +
                'Sign in as usual and switch profiles from the picker at the top.',
            })
          } else {
            setIssued({
              email: result.email,
              link: result.setupLink,
              purpose: 'setup',
              emailed: result.emailed,
              emailProblem: result.emailProblem,
            })
          }
          await load()
        }}
      />

      <LinkModal issued={issued} onClose={() => setIssued(null)} />
    </div>
  )
}

function AddAdminModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (result: {
    email: string
    setupLink: string | null
    emailed: boolean
    emailProblem: string | null
    addedToExistingAccount: boolean
  }) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (!open) return null

  const submit = async () => {
    setBusy(true)
    try {
      const result = await api.createAdmin({ name: name.trim(), email: email.trim(), phone })
      setName('')
      setEmail('')
      setPhone('')
      onClose()
      await onCreated(result)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'We could not create that account.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Add an admin">
      <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          They run the business — prices, orders, refunds, payouts. You will get a one-time link to
          pass on; they choose their own password.
        </p>

        <Field label="Their name" htmlFor="admin-name">
          <TextInput
            id="admin-name"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setError('')
            }}
          />
        </Field>

        <Field label="Email they will sign in with" htmlFor="admin-email">
          <TextInput
            id="admin-email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
              setError('')
            }}
          />
        </Field>

        <Field label="Phone number" htmlFor="admin-phone" error={error} hint="10 digits, like 0209876543.">
          <TextInput
            id="admin-phone"
            inputMode="numeric"
            value={phone}
            invalid={Boolean(error)}
            onChange={(event) => {
              setPhone(event.target.value)
              setError('')
            }}
          />
        </Field>

        <div className="flex gap-2">
          <Button
            block
            loading={busy}
            disabled={!name.trim() || !email.trim() || !phone.trim()}
            onClick={() => void submit()}
          >
            Create and get link
          </Button>
          <Button block variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * The link, shown once, alongside whether it was actually emailed.
 *
 * The server says which — it tries to send and reports back — and this reads that
 * answer rather than assuming. It previously hardcoded "Nothing has been
 * emailed", which stayed on screen after mail started working and told the
 * operator to hand-deliver links that had already arrived. The exact failure the
 * flag was added to prevent, committed in the message about preventing it.
 *
 * The link is shown either way. Even when the email went, a copy costs nothing
 * and rescues the case where it lands in spam.
 */
function LinkModal({
  issued,
  onClose,
}: {
  issued: {
    email: string
    link: string
    purpose: string
    emailed: boolean
    emailProblem: string | null
  } | null
  onClose: () => void
}) {
  if (!issued) return null

  return (
    <Modal
      open
      onClose={onClose}
      title={issued.emailed ? 'Link emailed' : 'Pass this link on'}
    >
      <div className="space-y-4">
        {issued.emailed ? (
          <Callout tone="success" icon={<CheckIcon className="size-4" />}>
            <strong className="font-semibold">Emailed to {issued.email}.</strong> The link below is
            the same one, in case it lands in their spam folder.
          </Callout>
        ) : (
          <Callout tone="warning" icon={<AlertIcon className="size-4" />}>
            <strong className="font-semibold">Nothing has been emailed.</strong>{' '}
            {issued.emailProblem ?? 'Email is not working on this server.'} Send this to{' '}
            {issued.email} yourself — WhatsApp, a message, however you normally reach them.
          </Callout>
        )}

        <CopyField label="One-time link" value={issued.link} />

        <p className="text-sm text-slate-600 dark:text-slate-300">
          It works once and expires in{' '}
          {issued.purpose === 'reset' ? 'an hour' : '48 hours'}. If it goes astray, create another
          from the team list — doing so cancels this one.
        </p>

        <Button block onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  )
}
