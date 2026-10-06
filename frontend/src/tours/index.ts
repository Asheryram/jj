import { adminMoneyPageTours } from './adminMoneyPages'
import { adminPageTours } from './adminPages'
import { adminTaskTours } from './adminTasks'
import { agentTours } from './agent'
import type { Tour } from './types'

/** Every tour, page tours before walkthroughs, in the order the checklist lists them. */
export const ALL_TOURS: Tour[] = [...adminPageTours, ...adminMoneyPageTours, ...adminTaskTours, ...agentTours]
