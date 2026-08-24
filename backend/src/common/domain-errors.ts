/**
 * NFR-4.3 — domain failures carry a stable machine code AND the exact sentence
 * the user should read. The frontend never composes error copy from a code; it
 * shows `message`. The code exists so behaviour can branch without string
 * matching.
 */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'DomainError'
  }
}

export class InsufficientBalanceError extends DomainError {
  /**
   * Two situations, and the same sentence does not fit both.
   *
   * Spending is "this costs more than you have". Withdrawing is "you asked for
   * more than you have earned" — and an agent has earnings, not a wallet, so the
   * shared wording told them about an account they do not hold and a purchase
   * they were not making.
   */
  constructor(balance: number, required: number, kind: 'purchase' | 'withdrawal' = 'purchase') {
    const ghs = (p: number) => `GHS ${(p / 100).toFixed(2)}`
    super(
      'INSUFFICIENT_BALANCE',
      kind === 'withdrawal'
        ? `You have ${ghs(balance)} available and asked to withdraw ${ghs(required)}.`
        : `Your wallet has ${ghs(balance)} and this costs ${ghs(required)} — you need ${ghs(required - balance)} more.`,
      409,
      { balance, required },
    )
  }
}

export class NotFoundError extends DomainError {
  constructor(what: string) {
    super('NOT_FOUND', what, 404)
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, detail?: Record<string, unknown>) {
    super('VALIDATION_FAILED', message, 400, detail)
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'You do not have access to that.') {
    super('FORBIDDEN', message, 403)
  }
}

export class UnauthorisedError extends DomainError {
  constructor(message = 'Your email or password is not right.') {
    super('UNAUTHORISED', message, 401)
  }
}

export class ConflictError extends DomainError {
  constructor(code: string, message: string, detail?: Record<string, unknown>) {
    super(code, message, 409, detail)
  }
}

/**
 * The split-at-sale invariant failed: money would have been created or
 * destroyed. This is never the user's fault and never recoverable in-request —
 * it means the pricing domain and the ledger disagree, so the transaction must
 * roll back loudly rather than commit a plausible-looking wrong number.
 */
export class LedgerImbalanceError extends DomainError {
  constructor(discrepancy: number, reference: string) {
    super(
      'LEDGER_IMBALANCE',
      'We could not complete that safely, so nothing was charged. Please try again.',
      500,
      { discrepancy, reference },
    )
  }
}
