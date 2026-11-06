export interface InstructionBlock {
  id: string;
  label: string;
  text: string;
}

export interface InstructionSetting {
  enabled: boolean;
  text: string;
}

export interface InstructionOptions {
  signal?: AbortSignal;
  instructionSettings?: Record<string, InstructionSetting>;
}

export interface FileFilter {
  includeExtensions: string;
  includeFiles: string;
  ignoreFiles: string;
  ignoreDirs: string;
}

export interface ReviewFile {
  old_path?: string;
  new_path?: string;
  deleted_file?: boolean;
}
