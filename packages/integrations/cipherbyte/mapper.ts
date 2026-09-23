import {
  CompanyVerificationResult,
  PersonVerificationResult,
  VehicleVerificationResult,
  VerificationStatus,
} from "@escrow-ecuador/domain";
import {
  CipherByteCedulaResponse,
  CipherByteRucResponse,
  CipherByteVehiculoResponse,
} from "./types.js";

export function mapPersonResponse(
  cedula: string,
  raw: CipherByteCedulaResponse,
): PersonVerificationResult {
  const name =
    raw.nombre ||
    [
      raw.primerNombre,
      raw.segundoNombre,
      raw.primerApellido,
      raw.segundoApellido,
    ]
      .filter(Boolean)
      .join(" ") ||
    undefined;

  return {
    status: raw.cedula
      ? VerificationStatus.VERIFIED
      : VerificationStatus.NOT_FOUND,
    identification: raw.cedula || cedula,
    name,
    birthDate: raw.fechaNacimiento,
    provider: "CIPHERBYTE",
    verifiedAt: new Date(),
    providerReference: `cb_cedula_${raw.cedula || cedula}`,
    rawData: raw as unknown as Record<string, unknown>,
  };
}

export function mapVehicleResponse(
  plate: string,
  raw: CipherByteVehiculoResponse,
): VehicleVerificationResult {
  return {
    status: raw.placa
      ? VerificationStatus.VERIFIED
      : VerificationStatus.NOT_FOUND,
    plate: raw.placa || plate,
    brand: raw.marca,
    model: raw.modelo,
    color: raw.color,
    vehicleClass: raw.clase,
    year: raw.anio,
    service: raw.servicio,
    registrationDates: raw.fechasMatricula,
    tintedWindows: raw.polarizado,
    provider: "CIPHERBYTE",
    verifiedAt: new Date(),
    providerReference: `cb_vehiculo_${raw.placa || plate}`,
    rawData: raw as unknown as Record<string, unknown>,
  };
}

export function mapCompanyResponse(
  ruc: string,
  raw: CipherByteRucResponse,
): CompanyVerificationResult {
  return {
    status: raw.ruc
      ? VerificationStatus.VERIFIED
      : VerificationStatus.NOT_FOUND,
    ruc: raw.ruc || ruc,
    companyName: raw.razonsocial,
    tradeName: raw.nombreComercial,
    companyStatus: raw.estado,
    companyType: raw.tipoCompania,
    provider: "CIPHERBYTE",
    verifiedAt: new Date(),
    providerReference: `cb_ruc_${raw.ruc || ruc}`,
    rawData: raw as unknown as Record<string, unknown>,
  };
}
