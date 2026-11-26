import Dexie, { Table } from 'dexie';

export interface LocalFile {
  id?: number;
  projectId: string;
  name: string;
  content: string | Blob;
  type: string;
  uploadedAt: string;
}

export class ImpactLensDatabase extends Dexie {
  files!: Table<LocalFile>;

  constructor() {
    super('ImpactLensDatabase');
    this.version(2).stores({
      files: '++id, projectId, name'
    });
  }
}

export const localDb = new ImpactLensDatabase();
