// src/features/mdr/gridEngine.ts
import { apiFetch } from '../../api/client';

export type BinCode = 'WO' | 'FC' | 'DR' | 'MA';

export interface FileRules {
  tremorThreshold: number;
  connectivity: 4 | 8;
  minGroupSize: number;
  maxGroupSize: number;
  binning: {
    strategy: 'DIGIT_SUM_MOD' | 'MAX_DIGIT_MOD';
    order: [BinCode, BinCode, BinCode, BinCode];
  };
}

export interface RawTileResponse {
  tileRow: number;
  tileCol: number;
  originRow: number;
  originCol: number;
  rows: number;
  cols: number;
  values: string;
  tremor: string; // Base64 bytes (0..100)
  bins: string;   // '.' | 'W' | 'F' | 'D' | 'M'
  version: number;
}

export interface DecodedTile extends Omit<RawTileResponse, 'tremor'> {
  tremorBytes: Uint8Array;
  binsArray: string[];
}

export function decodeBase64Bytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export class TileStore {
  private fileId: string | number;
  private tileSize: number;
  private totalRows: number;
  private totalCols: number;
  private cache = new Map<string, DecodedTile>();
  private inFlight = new Map<string, { promise: Promise<DecodedTile>; controller: AbortController }>();

  constructor(fileId: string | number, tileSize: number, totalRows: number, totalCols: number) {
    this.fileId = fileId;
    this.tileSize = tileSize;
    this.totalRows = totalRows;
    this.totalCols = totalCols;
  }

  private key(tileRow: number, tileCol: number): string {
    return `${tileRow}:${tileCol}`;
  }

  getCachedTile(tileRow: number, tileCol: number): DecodedTile | undefined {
    return this.cache.get(this.key(tileRow, tileCol));
  }

  invalidateTile(tileRow: number, tileCol: number): void {
    this.cache.delete(this.key(tileRow, tileCol));
  }

  cancelOutOfView(visibleKeys: Set<string>): void {
    for (const [k, entry] of this.inFlight.entries()) {
      if (!visibleKeys.has(k)) {
        entry.controller.abort();
        this.inFlight.delete(k);
      }
    }
  }

  async ensureTile(tileRow: number, tileCol: number): Promise<DecodedTile> {
    const k = this.key(tileRow, tileCol);
    const cached = this.cache.get(k);
    if (cached) return cached;

    const existing = this.inFlight.get(k);
    if (existing) return existing.promise;

    const controller = new AbortController();
    const promise = apiFetch<RawTileResponse>(
      `/files/${this.fileId}/tiles/${tileRow}/${tileCol}`,
      { signal: controller.signal }
    )
      .then(({ data }) => {
        const decoded: DecodedTile = {
          ...data,
          tremorBytes: decodeBase64Bytes(data.tremor),
          binsArray: data.bins.split(''),
        };
        this.cache.set(k, decoded);
        this.inFlight.delete(k);
        return decoded;
      })
      .catch((err) => {
        this.inFlight.delete(k);
        throw err;
      });

    this.inFlight.set(k, { promise, controller });
    return promise;
  }

  markCellsRefined(cells: Array<{ r: number; c: number }>, bin: BinCode): void {
    const binChar = bin[0]; // 'W' | 'F' | 'D' | 'M'
    for (const { r, c } of cells) {
      const tr = Math.floor(r / this.tileSize);
      const tc = Math.floor(c / this.tileSize);
      const tile = this.cache.get(this.key(tr, tc));
      if (tile) {
        const localR = r - tile.originRow;
        const localC = c - tile.originCol;
        const idx = localR * tile.cols + localC;
        tile.binsArray[idx] = binChar;
      }
    }
  }

  async findConnectedGroup(
    startR: number,
    startC: number,
    rules: FileRules
  ): Promise<{
    cells: Array<{ r: number; c: number; digit: number }>;
    targetBin: BinCode | null;
    isNoise: boolean;
  }> {
    const visited = new Set<string>();
    const queue: Array<{ r: number; c: number }> = [{ r: startR, c: startC }];
    const cells: Array<{ r: number; c: number; digit: number }> = [];

    const dirs4 = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ];
    const dirs8 = [
      ...dirs4,
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ];
    const dirs = rules.connectivity === 8 ? dirs8 : dirs4;

    while (queue.length > 0) {
      const curr = queue.shift()!;
      const cellKey = `${curr.r},${curr.c}`;
      if (visited.has(cellKey)) continue;
      visited.add(cellKey);

      if (curr.r < 0 || curr.r >= this.totalRows || curr.c < 0 || curr.c >= this.totalCols) {
        continue;
      }

      const tr = Math.floor(curr.r / this.tileSize);
      const tc = Math.floor(curr.c / this.tileSize);
      const tile = await this.ensureTile(tr, tc);

      const localR = curr.r - tile.originRow;
      const localC = curr.c - tile.originCol;
      const idx = localR * tile.cols + localC;

      const tremor = tile.tremorBytes[idx];
      const binState = tile.binsArray[idx];

      // Solo celdas que dan miedo y no han sido refinadas
      if (tremor < rules.tremorThreshold || binState !== '.') {
        continue;
      }

      const digit = Number(tile.values[idx]);
      cells.push({ r: curr.r, c: curr.c, digit });

      for (const [dr, dc] of dirs) {
        const nr = curr.r + dr;
        const nc = curr.c + dc;
        if (!visited.has(`${nr},${nc}`)) {
          queue.push({ r: nr, c: nc });
        }
      }
    }

    if (cells.length === 0) {
      return { cells: [], targetBin: null, isNoise: false };
    }

    const isNoise = cells.length < rules.minGroupSize || cells.length > rules.maxGroupSize;
    if (isNoise) {
      return { cells, targetBin: null, isNoise: true };
    }

    let metric = 0;
    if (rules.binning.strategy === 'DIGIT_SUM_MOD') {
      metric = cells.reduce((acc, item) => acc + item.digit, 0);
    } else {
      metric = cells.reduce((max, item) => Math.max(max, item.digit), 0);
    }

    const targetBin = rules.binning.order[metric % 4];
    return { cells, targetBin, isNoise: false };
  }
}