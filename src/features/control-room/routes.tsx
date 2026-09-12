import type { Locale, SpaceKind } from '../loans/types.js';
import type { ControlRoomDestination } from './types.js';

// Tasks 7–11 replace this placeholder with the real destination screens and
// wire the gateways below into them.
export interface ControlRoomRoutesProps {
  locale: Locale;
  spaceId: string;
  spaceKind: SpaceKind;
  destination: ControlRoomDestination;
  gateways: Record<string, unknown>;
  recordOpen: boolean;
  onCloseRecord(): void;
}

export function ControlRoomRoutes({ destination }: ControlRoomRoutesProps) {
  return <p>{destination} coming soon</p>;
}
