import {
  CompanyVerificationResult,
  CreateIdentityVerificationInput,
  IdentityVerificationSession,
  PersonVerificationResult,
  VehicleVerificationResult,
  VerificationProvider,
  VerificationStatus,
  VerifyCompanyInput,
  VerifyPersonInput,
  VerifyVehicleInput,
} from "@escrow-ecuador/domain";

export class MockVerificationProvider implements VerificationProvider {
  async verifyPerson(
    input: VerifyPersonInput,
  ): Promise<PersonVerificationResult> {
    const cleanCedula = (input.cedula || "").trim();

    if (!/^\d{10}$/.test(cleanCedula)) {
      throw new Error(
        `Invalid Cédula format. Expected 10 digits, got: ${input.cedula}`,
      );
    }

    if (cleanCedula === "0000000000" || cleanCedula === "9999999999") {
      return {
        status: VerificationStatus.NOT_FOUND,
        identification: cleanCedula,
        provider: "MOCK_VERIFICATION",
        verifiedAt: new Date(),
      };
    }

    return {
      status: VerificationStatus.VERIFIED,
      identification: cleanCedula,
      name: "JUAN CARLOS PEREZ LOPEZ",
      birthDate: "1990-05-15",
      provider: "MOCK_VERIFICATION",
      verifiedAt: new Date(),
      providerReference: `mock_cedula_${cleanCedula}`,
      rawData: { mock: true, cedula: cleanCedula },
    };
  }

  async verifyVehicle(
    input: VerifyVehicleInput,
  ): Promise<VehicleVerificationResult> {
    const cleanPlate = (input.plate || "").trim().toUpperCase();

    if (!/^[A-Z]{3}\d{3,4}$/.test(cleanPlate)) {
      throw new Error(
        `Invalid plate format. Expected e.g. PBA1234 or ABC123, got: ${input.plate}`,
      );
    }

    if (cleanPlate === "ZZZ0000" || cleanPlate === "XXX0000") {
      return {
        status: VerificationStatus.NOT_FOUND,
        plate: cleanPlate,
        provider: "MOCK_VERIFICATION",
        verifiedAt: new Date(),
      };
    }

    return {
      status: VerificationStatus.VERIFIED,
      plate: cleanPlate,
      brand: "CHEVROLET",
      model: "SAIL",
      color: "GRIS",
      vehicleClass: "AUTOMOVIL",
      year: 2020,
      service: "PARTICULAR",
      registrationDates: {
        ultimaMatricula: "2023-08-10",
        proximaMatricula: "2024-08-10",
      },
      tintedWindows: false,
      provider: "MOCK_VERIFICATION",
      verifiedAt: new Date(),
      providerReference: `mock_plate_${cleanPlate}`,
      rawData: { mock: true, plate: cleanPlate },
    };
  }

  async verifyCompany(
    input: VerifyCompanyInput,
  ): Promise<CompanyVerificationResult> {
    const cleanRuc = (input.ruc || "").trim();

    if (!/^\d{13}$/.test(cleanRuc)) {
      throw new Error(
        `Invalid RUC format. Expected 13 digits, got: ${input.ruc}`,
      );
    }

    if (cleanRuc === "0000000000000" || cleanRuc === "9999999999999") {
      return {
        status: VerificationStatus.NOT_FOUND,
        ruc: cleanRuc,
        provider: "MOCK_VERIFICATION",
        verifiedAt: new Date(),
      };
    }

    return {
      status: VerificationStatus.VERIFIED,
      ruc: cleanRuc,
      companyName: "COMPANIA DE PRUEBA ECUADOR S.A.",
      tradeName: "PRUEBACORP",
      companyStatus: "ACTIVO",
      companyType: "SOCIEDAD ANONIMA",
      provider: "MOCK_VERIFICATION",
      verifiedAt: new Date(),
      providerReference: `mock_ruc_${cleanRuc}`,
      rawData: { mock: true, ruc: cleanRuc },
    };
  }

  async createIdentityVerification(
    input: CreateIdentityVerificationInput,
  ): Promise<IdentityVerificationSession> {
    const sessionId = `mock_sess_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    return {
      status: VerificationStatus.PENDING,
      verificationUrl: `http://localhost:3000/verify-identity/${sessionId}`,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      providerReference: sessionId,
    };
  }
}
