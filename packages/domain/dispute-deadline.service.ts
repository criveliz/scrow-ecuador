import type { AuditLogRepository } from "../database/repositories/audit-log.repository.js";
import type { DisputeDeadlineRepository } from "../database/repositories/dispute-deadline.repository.js";
import type { DisputeEventRepository } from "../database/repositories/dispute-event.repository.js";
import type { DisputeDeadline } from "../database/types/index.js";

export enum DeadlineType {
  EVIDENCE_SUBMISSION = "EVIDENCE_SUBMISSION",
  BUYER_RESPONSE = "BUYER_RESPONSE",
  SELLER_RESPONSE = "SELLER_RESPONSE",
  OPERATIONAL_REVIEW = "OPERATIONAL_REVIEW",
}

export enum DeadlineStatus {
  PENDING = "PENDING",
  FULFILLED = "FULFILLED",
  EXPIRED = "EXPIRED",
  CANCELLED = "CANCELLED",
}

export class DisputeDeadlineService {
  constructor(
    private readonly deadlineRepo: DisputeDeadlineRepository,
    private readonly disputeEventRepo: DisputeEventRepository,
    private readonly auditRepo: AuditLogRepository,
    private readonly getTime: () => Date = () => new Date()
  ) {}

  async createDeadline(
    disputeId: string,
    type: DeadlineType | string,
    durationHours: number
  ): Promise<DisputeDeadline> {
    const now = this.getTime();
    const dueAt = new Date(now.getTime() + durationHours * 60 * 60 * 1000);

    const deadline = await this.deadlineRepo.createDeadline({
      dispute_id: disputeId,
      deadline_type: type,
      due_at: dueAt,
      status: DeadlineStatus.PENDING,
    });

    await this.auditRepo.create({
      actor_id: null,
      action: "DISPUTE_DEADLINE_CREATED",
      entity_type: "DISPUTE_DEADLINE",
      entity_id: deadline.id,
      previous_state: null,
      new_state: DeadlineStatus.PENDING,
      metadata: {
        dispute_id: disputeId,
        deadline_type: type,
        due_at: dueAt.toISOString(),
      },
    });

    return deadline;
  }

  async checkAndExpireDeadlines(): Promise<DisputeDeadline[]> {
    const now = this.getTime();
    const pastDue = await this.deadlineRepo.findPendingPastDue(now);
    const expiredDeadlines: DisputeDeadline[] = [];

    for (const dl of pastDue) {
      const updated = await this.deadlineRepo.updateStatus(dl.id, DeadlineStatus.EXPIRED, now);
      expiredDeadlines.push(updated);

      await this.disputeEventRepo.createEvent({
        dispute_id: dl.dispute_id,
        previous_status: null,
        new_status: "DEADLINE_EXPIRED",
        actor_id: null,
        actor_role: "SYSTEM",
        action: "DEADLINE_EXPIRED",
        reason: `Deadline '${dl.deadline_type}' expired at ${now.toISOString()}`,
        metadata: {
          deadline_id: dl.id,
          deadline_type: dl.deadline_type,
          due_at: dl.due_at,
        },
      });

      await this.auditRepo.create({
        actor_id: null,
        action: "DISPUTE_DEADLINE_EXPIRED",
        entity_type: "DISPUTE_DEADLINE",
        entity_id: dl.id,
        previous_state: DeadlineStatus.PENDING,
        new_state: DeadlineStatus.EXPIRED,
        metadata: {
          dispute_id: dl.dispute_id,
          deadline_type: dl.deadline_type,
          note: "Expired deadline created an operational review event; no money was moved.",
        },
      });
    }

    return expiredDeadlines;
  }
}
