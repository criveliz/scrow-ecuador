import { VerificationRepository } from "@escrow-ecuador/database";
import {
  VerificationEvent,
  VerificationEventEmitter,
  VerificationEventType,
} from "./verification.events.js";
import {
  CreateIdentityVerificationInput,
  IdentityVerificationSession,
  PersonVerificationResult,
  CompanyVerificationResult,
  VehicleVerificationResult,
  VerificationProvider,
  VerificationStatus,
  VerificationType,
} from "./verification.types.js";

export class CoreVerificationService {
  constructor(
    private readonly provider: VerificationProvider,
    private readonly repository: VerificationRepository,
    private readonly eventEmitter: VerificationEventEmitter = new VerificationEventEmitter(),
  ) {}

  getEventEmitter(): VerificationEventEmitter {
    return this.eventEmitter;
  }

  async verifyPerson(
    escrowId: string,
    partyId: string,
    cedula: string,
  ): Promise<{ recordId: string; result: PersonVerificationResult }> {
    const result = await this.provider.verifyPerson({ cedula });

    const record = await this.repository.create({
      escrow_id: escrowId,
      party_id: partyId,
      provider: result.provider,
      verification_type: VerificationType.PERSON,
      status: result.status,
      provider_reference: result.providerReference ?? null,
      verified_at: result.verifiedAt,
      raw_response: result.rawData ?? null,
    });

    await this.eventEmitter.emit({
      type: VerificationEventType.PERSON_VERIFIED,
      verificationId: record.id,
      escrowId,
      partyId,
      provider: result.provider,
      timestamp: new Date(),
      payload: {
        status: result.status,
        identification: result.identification,
        name: result.name,
      },
    });

    return { recordId: record.id, result };
  }

  async verifyVehicle(
    escrowId: string,
    partyId: string,
    plate: string,
  ): Promise<{ recordId: string; result: VehicleVerificationResult }> {
    const result = await this.provider.verifyVehicle({ plate });

    const record = await this.repository.create({
      escrow_id: escrowId,
      party_id: partyId,
      provider: result.provider,
      verification_type: VerificationType.VEHICLE,
      status: result.status,
      provider_reference: result.providerReference ?? null,
      verified_at: result.verifiedAt,
      raw_response: result.rawData ?? null,
    });

    await this.eventEmitter.emit({
      type: VerificationEventType.VEHICLE_VERIFIED,
      verificationId: record.id,
      escrowId,
      partyId,
      provider: result.provider,
      timestamp: new Date(),
      payload: {
        status: result.status,
        plate: result.plate,
        brand: result.brand,
        model: result.model,
      },
    });

    return { recordId: record.id, result };
  }

  async verifyCompany(
    escrowId: string,
    partyId: string,
    ruc: string,
  ): Promise<{ recordId: string; result: CompanyVerificationResult }> {
    const result = await this.provider.verifyCompany({ ruc });

    const record = await this.repository.create({
      escrow_id: escrowId,
      party_id: partyId,
      provider: result.provider,
      verification_type: VerificationType.COMPANY,
      status: result.status,
      provider_reference: result.providerReference ?? null,
      verified_at: result.verifiedAt,
      raw_response: result.rawData ?? null,
    });

    await this.eventEmitter.emit({
      type: VerificationEventType.COMPANY_VERIFIED,
      verificationId: record.id,
      escrowId,
      partyId,
      provider: result.provider,
      timestamp: new Date(),
      payload: {
        status: result.status,
        ruc: result.ruc,
        companyName: result.companyName,
      },
    });

    return { recordId: record.id, result };
  }

  async createIdentityVerification(
    input: CreateIdentityVerificationInput,
  ): Promise<{ recordId: string; session: IdentityVerificationSession }> {
    const session = await this.provider.createIdentityVerification(input);

    const record = await this.repository.create({
      escrow_id: input.escrowId,
      party_id: input.partyId,
      provider: "CIPHERID",
      verification_type: VerificationType.IDENTITY,
      status: session.status,
      provider_reference:
        session.providerReference ?? session.verificationId ?? null,
      raw_response: {
        verificationUrl: session.verificationUrl,
        expiresAt: session.expiresAt ? session.expiresAt.toISOString() : null,
      },
    });

    await this.eventEmitter.emit({
      type: VerificationEventType.IDENTITY_VERIFICATION_REQUESTED,
      verificationId: record.id,
      escrowId: input.escrowId,
      partyId: input.partyId,
      provider: "CIPHERID",
      timestamp: new Date(),
      payload: {
        status: session.status,
        verificationUrl: session.verificationUrl,
        providerReference: session.providerReference,
      },
    });

    return {
      recordId: record.id,
      session: {
        ...session,
        verificationId: record.id,
      },
    };
  }
}
