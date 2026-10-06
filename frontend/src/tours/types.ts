/**
 * Guided tours: short, step-by-step walks over the real screens.
 *
 * A step points at an element by its `data-tour` attribute, so a tour never
 * depends on class names or layout. A step whose element is not on screen
 * (hidden on a phone, an empty list, a section only some admins see) is shown
 * as a centred card instead, so a tour never breaks.
 *
 * Text supports **bold** for exact button and page names.
 */

export type TourRole = 'admin' | 'agent'

export interface TourStep {
  /** The `data-tour` value of the element to highlight. Omit for a centred card. */
  target?: string
  title: string
  body: string
  /** Go to this page before showing the step, for tours that cross screens. */
  route?: string
}

export interface Tour {
  /** Stable id, saved on the account when finished. Lowercase, digits and dashes. */
  id: string
  role: TourRole
  /** 'page' explains one screen; 'task' walks through a real situation across screens. */
  kind: 'page' | 'task'
  title: string
  /** One line for the checklist. */
  summary: string
  /** The page it starts on. A page tour is offered there by "Take the tour". */
  route: string
  steps: TourStep[]
}
