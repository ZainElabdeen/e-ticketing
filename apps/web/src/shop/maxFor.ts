import type { TicketType } from '../api/types';

const MAX_PER_TYPE = 10;

export const maxFor = (t: TicketType): number => Math.min(MAX_PER_TYPE, Math.max(0, t.available));
