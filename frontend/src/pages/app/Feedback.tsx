import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, type FeedbackCategory, type FeedbackReport } from '../../lib/api'
import { useStore } from '../../state/store'
import { dateTime } from '../../lib/format'
import {
  Badge,
  Button,
  Card,
  CardHead,
  EmptyState,
  Field,
  PageHead,
  Segmented,
  Spinner,
  Textarea,
} from '../../components/ui'
import { HelpIcon } from '../../components/icons'

/**
 * An agent's own channel straight to admin/superadmin, for a suggestion or
 * a problem with the app itself, not a customer support question and not
 * routed through email. See `FeedbackReport` on the backend.
 */
export default function Feedback() {
  const { pushToast } = useStore()
  const [category, setCategory] = useState<FeedbackCategory>('suggestion')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [mine, setMine] = useState<FeedbackReport[] | null>(null)
  const load = useCallback(async () => {
    try {
      setMine(await api.myFeedback())
    } catch {
      setMine([])
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const submit = async () => {
    if (message.trim().length < 5) {
      setError('Say a little more, five characters minimum.')
      return
    }
    setBusy(true)
    try {
      await api.submitFeedback(category, message.trim())
      setMessage('')
      setError('')
      await load()
      pushToast({
        tone: 'success',
        title: 'Sent',
        detail: "Admin and the platform team can see it. You'll see it here as reviewed or resolved.",
      })
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'We could not send that.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHead
        title="Feedback"
        subtitle="A suggestion, or something not working right, sent straight to admin and the platform team."
      />

      <Card className="mt-3">
        <form
          className="space-y-4 p-4 sm:p-5"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <Segmented<FeedbackCategory>
            options={[
              { value: 'suggestion', label: 'Suggestion' },
              { value: 'issue', label: 'Something is wrong' },
            ]}
            value={category}
            onChange={setCategory}
          />

          <Field
            label={category === 'suggestion' ? 'What would help?' : 'What went wrong?'}
            htmlFor="feedback-message"
            error={error}
          >
            <Textarea
              id="feedback-message"
              placeholder={
                category === 'suggestion'
                  ? 'It would help if I could filter my sales by network'
                  : "The 'Withdraw' button did nothing when I tapped it on my phone"
              }
              value={message}
              invalid={Boolean(error)}
              onChange={(event) => {
                setMessage(event.target.value)
                setError('')
              }}
            />
          </Field>

          <Button type="submit" loading={busy}>
            Send
          </Button>
        </form>
      </Card>

      <Card className="mt-3">
        <CardHead title="What you've sent" subtitle="Newest first" />
        <div className="space-y-2 p-4 sm:p-5">
          {mine === null ? (
            <div className="py-8 text-center">
              <Spinner className="mx-auto size-6 text-brand-600 dark:text-brand-300" />
            </div>
          ) : mine.length === 0 ? (
            <EmptyState
              icon={<HelpIcon className="size-6" />}
              title="Nothing sent yet"
              detail="A suggestion or a problem report you send appears here, with its status."
            />
          ) : (
            mine.map((row) => (
              <div key={row.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Badge tone={row.category === 'issue' ? 'warning' : 'neutral'}>
                        {row.category === 'issue' ? 'Issue' : 'Suggestion'}
                      </Badge>
                      <StatusPill status={row.status} />
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-100">
                      {row.message}
                    </p>
                  </div>
                  <p className="shrink-0 text-xs text-slate-500 dark:text-slate-400">{dateTime(row.createdAt)}</p>
                </div>
                {row.note && (
                  <p className="mt-2 rounded-lg bg-slate-50 dark:bg-slate-800 p-2.5 text-xs text-slate-600 dark:text-slate-300">
                    {row.note}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  )
}

function StatusPill({ status }: { status: FeedbackReport['status'] }) {
  if (status === 'resolved') return <Badge tone="success">Resolved</Badge>
  if (status === 'reviewed') return <Badge tone="info">Reviewed</Badge>
  return <Badge tone="neutral">Sent</Badge>
}
