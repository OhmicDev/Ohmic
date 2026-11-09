import { ClosedError, TimeoutError } from '../client/VescClient'
import { errorText } from '../lib/format'

/** Why a request to a controller failed, in words a rider understands. */
export const controllerErrorText = (e: unknown) =>
  e instanceof TimeoutError ? 'The controller didn’t answer.' : e instanceof ClosedError ? 'The connection closed.' : errorText(e)
