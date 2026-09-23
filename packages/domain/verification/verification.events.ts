export enum VerificationEventType {
  IDENTITY_VERIFICATION_REQUESTED = "IDENTITY_VERIFICATION_REQUESTED",
  IDENTITY_VERIFICATION_COMPLETED = "IDENTITY_VERIFICATION_COMPLETED",
  IDENTITY_VERIFICATION_FAILED = "IDENTITY_VERIFICATION_FAILED",
  PERSON_VERIFIED = "PERSON_VERIFIED",
  VEHICLE_VERIFIED = "VEHICLE_VERIFIED",
  COMPANY_VERIFIED = "COMPANY_VERIFIED",
}

export interface VerificationEvent {
  type: VerificationEventType;
  verificationId: string;
  escrowId?: string;
  partyId?: string;
  provider: string;
  timestamp: Date;
  payload: Record<string, unknown>;
}

export type VerificationEventListener = (
  event: VerificationEvent,
) => Promise<void> | void;

export class VerificationEventEmitter {
  private listeners: Map<string, VerificationEventListener[]> = new Map();

  on(
    eventType: VerificationEventType | "*",
    listener: VerificationEventListener,
  ): void {
    const existing = this.listeners.get(eventType) ?? [];
    existing.push(listener);
    this.listeners.set(eventType, existing);
  }

  async emit(event: VerificationEvent): Promise<void> {
    const specificListeners = this.listeners.get(event.type) ?? [];
    const wildcardListeners = this.listeners.get("*") ?? [];
    const allListeners = [...specificListeners, ...wildcardListeners];

    for (const listener of allListeners) {
      await listener(event);
    }
  }
}
