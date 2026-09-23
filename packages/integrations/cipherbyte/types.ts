export interface CipherByteSaldoResponse {
  saldo: number;
  moneda?: string;
  usuario?: string;
  tokens?: number;
}

export interface CipherByteCedulaResponse {
  cedula: string;
  nombre: string;
  primerNombre?: string;
  segundoNombre?: string;
  primerApellido?: string;
  segundoApellido?: string;
  fechaNacimiento?: string;
  nacionalidad?: string;
  estadoCivil?: string;
  genero?: string;
  provincia?: string;
  canton?: string;
  parroquia?: string;
}

export interface CipherByteLicenciaResponse {
  cedula: string;
  nombre?: string;
  puntos?: number;
  tipoLicencia?: string;
  fechaEmision?: string;
  fechaCaducidad?: string;
  estado?: string;
}

export interface CipherByteVehiculoResponse {
  placa: string;
  marca?: string;
  modelo?: string;
  color?: string;
  clase?: string;
  anio?: number;
  servicio?: string;
  fechasMatricula?: {
    ultimaMatricula?: string;
    proximaMatricula?: string;
    fechaCompra?: string;
  };
  polarizado?: boolean | string;
  chasis?: string;
  motor?: string;
  estado?: string;
}

export interface CipherByteCompanySearchResponseItem {
  ruc: string;
  razonsocial: string;
  nombreComercial?: string;
  estado?: string;
}

export interface CipherByteRucResponse {
  ruc: string;
  razonsocial: string;
  nombreComercial?: string;
  estado?: string;
  tipoCompania?: string;
  actividadEconomica?: string;
  direccion?: string;
  representanteLegal?: string;
}

export interface CipherByteClientConfig {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  maxRetries?: number;
}
