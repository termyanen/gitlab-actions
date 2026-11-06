export interface Pipeline {
  id: number;
  project_id?: number;
  sha?: string;
  ref?: string;
  status: string;
}
export interface PipelineSelection {
  id: number;
  projectId: number | null;
}
export interface Job {
  id: number;
  name: string;
  status: string;
  web_url?: string;
  stage?: string;
}
