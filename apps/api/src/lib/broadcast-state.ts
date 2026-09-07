import { canTransitionBroadcast, type BroadcastStatus } from '@pagebroadcast/types';
import { AppError } from './errors.js';

export function assertBroadcastTransition(from: BroadcastStatus, to: BroadcastStatus) {
  if (!canTransitionBroadcast(from, to)) {
    throw new AppError(
      'INVALID_TRANSITION',
      `Cannot transition broadcast from ${from} to ${to}.`,
      409
    );
  }
}
