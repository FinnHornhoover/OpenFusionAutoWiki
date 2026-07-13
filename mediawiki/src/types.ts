export interface Config {
  apiUrl: string;
  schemaVersion: number;
  maxArticleBytes: number;
  shardSize: number;
  editSummary: string;
  collapsibleTemplate: string;
  checkpointRoot: string;
}

export interface BuildEntry {
  slug: string;
  displayName: string;
  date: string;
  fixed: boolean;
}

export type PageOwnership = "section" | "generated";

export interface ManifestPage {
  title: string;
  path: string;
  hash: string;
  build: string;
  type: string;
  ownership: PageOwnership;
  sections: Array<{ key: string; heading: string; hash: string }>;
  media: string[];
}

export interface ExportManifest {
  schemaVersion: number;
  generatedAt: string;
  pageCount: number;
  shards: Array<{ id: string; hash: string; path: string; pageCount: number }>;
  media: Array<{ source: string; name: string; hash: string }>;
}
