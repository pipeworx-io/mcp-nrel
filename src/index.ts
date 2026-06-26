interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * NREL MCP — wraps the US National Renewable Energy Laboratory developer API
 * (developer.nrel.gov, served via api.data.gov).
 *
 * Tools:
 * - pvwatts: solar energy production estimate for a PV system (PVWatts v8)
 * - solar_resource: solar resource (sunlight: DNI/GHI) for a location
 * - alt_fuel_stations: EV charging / alternative fuel stations near a point or state
 * - utility_rates: electricity utility rates ($/kWh) for a location
 *
 * Dual-key: pass your own NREL / api.data.gov key via the OPTIONAL _apiKey
 * argument for higher limits; otherwise the shared Pipeworx key is used.
 * The key is sent as the `api_key` query parameter. All requests are GET.
 */


const BASE_URL = 'https://developer.nrel.gov';

const tools: McpToolExport['tools'] = [
  {
    name: 'pvwatts',
    description:
      'Solar energy production estimate (PVWatts v8) for a photovoltaic system at a lat/lon. Returns estimated annual AC energy (kWh), capacity factor, solar radiation, and monthly production. Example: pvwatts({ lat: 40.0, lon: -105.25, system_capacity: 4 })',
    inputSchema: {
      type: 'object' as const,
      properties: {
        lat: { type: 'number', description: 'Latitude in decimal degrees, e.g. 40.0' },
        lon: { type: 'number', description: 'Longitude in decimal degrees, e.g. -105.25' },
        system_capacity: { type: 'number', description: 'System size in kW DC (default 4)' },
        tilt: { type: 'number', description: 'Array tilt in degrees (default 20)' },
        azimuth: { type: 'number', description: 'Array azimuth in degrees, 180 = south (default 180)' },
        array_type: {
          type: 'number',
          description:
            'Array type: 0=fixed open rack, 1=fixed roof mount, 2=1-axis tracking, 3=1-axis backtracking, 4=2-axis tracking (default 1)',
        },
        module_type: {
          type: 'number',
          description: 'Module type: 0=standard, 1=premium, 2=thin film (default 0)',
        },
        losses: { type: 'number', description: 'System losses in percent (default 14)' },
        _apiKey: {
          type: 'string',
          description:
            'Optional — your own NREL / api.data.gov API key for higher limits; omit to use the shared Pipeworx key.',
        },
      },
      required: ['lat', 'lon'],
    },
  },
  {
    name: 'solar_resource',
    description:
      'Solar resource (sunlight) for a location: average direct normal irradiance (DNI), global horizontal irradiance (GHI), and tilt-at-latitude radiation, annual plus monthly. Example: solar_resource({ lat: 40.0, lon: -105.25 })',
    inputSchema: {
      type: 'object' as const,
      properties: {
        lat: { type: 'number', description: 'Latitude in decimal degrees, e.g. 40.0' },
        lon: { type: 'number', description: 'Longitude in decimal degrees, e.g. -105.25' },
        _apiKey: {
          type: 'string',
          description:
            'Optional — your own NREL / api.data.gov API key for higher limits; omit to use the shared Pipeworx key.',
        },
      },
      required: ['lat', 'lon'],
    },
  },
  {
    name: 'alt_fuel_stations',
    description:
      'EV charging / alternative fuel stations near a point (lat/lon + radius) or within a state. Filter by fuel type (ELEC, E85, LPG, CNG, HY, etc.). Returns station names, addresses, EV connectors/network, access hours, and distance. Example: alt_fuel_stations({ lat: 40.0, lon: -105.25, fuel_type: "ELEC", radius: 25 })',
    inputSchema: {
      type: 'object' as const,
      properties: {
        lat: { type: 'number', description: 'Latitude in decimal degrees (with lon, searches by radius)' },
        lon: { type: 'number', description: 'Longitude in decimal degrees (with lat, searches by radius)' },
        state: { type: 'string', description: '2-letter US state code (used when lat/lon not given), e.g. "CO"' },
        fuel_type: {
          type: 'string',
          description: "Fuel type code, e.g. 'ELEC', 'E85', 'LPG', 'CNG', 'HY' (default 'ELEC')",
        },
        radius: { type: 'number', description: 'Search radius in miles when lat/lon given (default 25)' },
        limit: { type: 'number', description: 'Max stations to return (default 20, max 50)' },
        _apiKey: {
          type: 'string',
          description:
            'Optional — your own NREL / api.data.gov API key for higher limits; omit to use the shared Pipeworx key.',
        },
      },
      required: [],
    },
  },
  {
    name: 'utility_rates',
    description:
      'Electricity utility rates ($/kWh) for a location: the serving utility plus average residential, commercial, and industrial rates. Example: utility_rates({ lat: 40.0, lon: -105.25 })',
    inputSchema: {
      type: 'object' as const,
      properties: {
        lat: { type: 'number', description: 'Latitude in decimal degrees, e.g. 40.0' },
        lon: { type: 'number', description: 'Longitude in decimal degrees, e.g. -105.25' },
        _apiKey: {
          type: 'string',
          description:
            'Optional — your own NREL / api.data.gov API key for higher limits; omit to use the shared Pipeworx key.',
        },
      },
      required: ['lat', 'lon'],
    },
  },
];

// NREL/api.data.gov: key goes in the `api_key` query param. All GET.
// Returns an error object (not a throw) for missing key / non-2xx so the
// gateway surfaces a clean, actionable payload.
async function nrelGet(apiKey: string, path: string, params: URLSearchParams): Promise<unknown> {
  if (!apiKey) {
    return { error: 'api_key_required', message: 'No NREL/api.data.gov key available.' };
  }
  params.set('api_key', apiKey);
  const res = await fetch(`${BASE_URL}${path}?${params}`);
  if (!res.ok) {
    const text = await res.text();
    return { error: res.status, message: text };
  }
  return res.json();
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const apiKey = args._apiKey as string;
  delete args._apiKey;

  switch (name) {
    case 'pvwatts':
      return pvwatts(args, apiKey);
    case 'solar_resource':
      return solarResource(args, apiKey);
    case 'alt_fuel_stations':
      return altFuelStations(args, apiKey);
    case 'utility_rates':
      return utilityRates(args, apiKey);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function pvwatts(args: Record<string, unknown>, apiKey: string) {
  const params = new URLSearchParams({
    lat: String(args.lat),
    lon: String(args.lon),
    system_capacity: String(args.system_capacity ?? 4),
    tilt: String(args.tilt ?? 20),
    azimuth: String(args.azimuth ?? 180),
    array_type: String(args.array_type ?? 1),
    module_type: String(args.module_type ?? 0),
    losses: String(args.losses ?? 14),
  });
  const data = (await nrelGet(apiKey, '/api/pvwatts/v8.json', params)) as
    | {
        outputs?: {
          ac_annual?: number;
          solrad_annual?: number;
          capacity_factor?: number;
          ac_monthly?: number[];
        };
        station_info?: { city?: string; state?: string };
        errors?: unknown;
      }
    | { error: unknown; message: unknown };
  if ('error' in data) return data;

  const { outputs, station_info, errors } = data;
  return {
    ac_annual_kwh: outputs?.ac_annual,
    capacity_factor: outputs?.capacity_factor,
    solrad_annual: outputs?.solrad_annual,
    ac_monthly_kwh: outputs?.ac_monthly,
    station: `${station_info?.city}, ${station_info?.state}`,
    errors,
  };
}

async function solarResource(args: Record<string, unknown>, apiKey: string) {
  const params = new URLSearchParams({ lat: String(args.lat), lon: String(args.lon) });
  const data = (await nrelGet(apiKey, '/api/solar/solar_resource/v1.json', params)) as
    | {
        outputs?: {
          avg_dni?: { annual?: number; monthly?: Record<string, number> };
          avg_ghi?: { annual?: number; monthly?: Record<string, number> };
          avg_lat_tilt?: { annual?: number; monthly?: Record<string, number> };
        };
      }
    | { error: unknown; message: unknown };
  if ('error' in data) return data;

  const { outputs } = data;
  return {
    avg_dni_annual: outputs?.avg_dni?.annual,
    avg_ghi_annual: outputs?.avg_ghi?.annual,
    avg_lat_tilt_annual: outputs?.avg_lat_tilt?.annual,
    ghi_monthly: outputs?.avg_ghi?.monthly,
  };
}

async function altFuelStations(args: Record<string, unknown>, apiKey: string) {
  const params = new URLSearchParams({
    fuel_type: (args.fuel_type as string) ?? 'ELEC',
    limit: String(Math.min(50, (args.limit as number) ?? 20)),
  });
  if (args.lat !== undefined && args.lon !== undefined) {
    params.set('latitude', String(args.lat));
    params.set('longitude', String(args.lon));
    params.set('radius', String(args.radius ?? 25));
  } else if (args.state) {
    params.set('state', String(args.state));
  }

  const data = (await nrelGet(apiKey, '/api/alt-fuel-stations/v1.json', params)) as
    | {
        total_results?: number;
        fuel_stations?: Array<{
          station_name?: string;
          street_address?: string;
          city?: string;
          state?: string;
          zip?: string;
          fuel_type_code?: string;
          ev_connector_types?: string[];
          ev_network?: string;
          access_days_time?: string;
          latitude?: number;
          longitude?: number;
          distance?: number;
        }>;
      }
    | { error: unknown; message: unknown };
  if ('error' in data) return data;

  const { total_results, fuel_stations } = data;
  return {
    total: total_results,
    stations: (fuel_stations || []).map((s) => ({
      name: s.station_name,
      address: `${s.street_address}, ${s.city}, ${s.state} ${s.zip}`,
      fuel_type: s.fuel_type_code,
      ev_connectors: s.ev_connector_types,
      ev_network: s.ev_network,
      access: s.access_days_time,
      lat: s.latitude,
      lon: s.longitude,
      distance: s.distance,
    })),
  };
}

async function utilityRates(args: Record<string, unknown>, apiKey: string) {
  const params = new URLSearchParams({ lat: String(args.lat), lon: String(args.lon) });
  const data = (await nrelGet(apiKey, '/api/utility_rates/v3.json', params)) as
    | {
        outputs?: {
          utility_name?: string;
          company_id?: string;
          residential?: number;
          commercial?: number;
          industrial?: number;
        };
      }
    | { error: unknown; message: unknown };
  if ('error' in data) return data;

  const { outputs } = data;
  return {
    utility: outputs?.utility_name,
    residential_rate: outputs?.residential,
    commercial_rate: outputs?.commercial,
    industrial_rate: outputs?.industrial,
  };
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
