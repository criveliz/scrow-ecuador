export enum NotificationEventType {
  DISPUTE_CREATED = "DISPUTE_CREATED",
  EVIDENCE_REQUESTED = "EVIDENCE_REQUESTED",
  EVIDENCE_SUBMITTED = "EVIDENCE_SUBMITTED",
  DISPUTE_ASSIGNED = "DISPUTE_ASSIGNED",
  DISPUTE_ESCALATED = "DISPUTE_ESCALATED",
  DISPUTE_RESOLVED = "DISPUTE_RESOLVED",
  DISPUTE_CLOSED = "DISPUTE_CLOSED",
  EVIDENCE_INTEGRITY_FAILURE = "EVIDENCE_INTEGRITY_FAILURE",
}

export interface NotificationEventPayload {
  eventType: NotificationEventType | string;
  escrowId: string;
  disputeId?: string;
  evidenceId?: string;
  recipientUserIds: string[];
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export type NotificationEventListener = (payload: NotificationEventPayload) => Promise<void> | void;

export class NotificationHookRegistry {
  private static instance: NotificationHookRegistry;
  private listeners: Map<string, NotificationEventListener[]> = new Map();

  static getInstance(): NotificationHookRegistry {
    if (!NotificationHookRegistry.instance) {
      NotificationHookRegistry.instance = new NotificationHookRegistry();
    }
    return NotificationHookRegistry.instance;
  }

  on(eventType: NotificationEventType | string, listener: NotificationEventListener): void {
    const list = this.listeners.get(eventType) ?? [];
    list.push(listener);
    this.listeners.set(eventType, list);
  }

  async emit(payload: NotificationEventPayload): Promise<void> {
    const list = this.listeners.get(payload.eventType) ?? [];
    for (const listener of list) {
      try {
        await listener(payload);
      } catch (err) {
        // Event listener failures must fail safely and not block main flow
        console.error(`Error in notification listener for ${payload.eventType}:`, err);
      }
    }
  }
}
