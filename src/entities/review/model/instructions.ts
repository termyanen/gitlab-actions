import { readStorage } from "../../../shared/api/storage";
import {
  DEFAULT_FILTER,
  FILTER_FIELDS,
  normalizeFilter,
  patterns,
} from "./file-scope";
import { INSTRUCTION_BLOCKS } from "./instructions-data";
import { REVIEW_PROMPT_MAX_LENGTH } from "./limits";
import { DEFAULT_REPEAT_PROMPT } from "./prompts";
import type {
  FileFilter,
  InstructionBlock,
  InstructionOptions,
  InstructionSetting,
} from "./types";
export const INSTRUCTION_PREFIX = "ai_review_rule_";
const RESPONSE_LANGUAGES = {
  auto: "",
  en: "English",
  ru: "Russian",
  de: "German",
  es: "Spanish",
  fr: "French",
  ja: "Japanese",
  zh_CN: "Simplified Chinese",
};

export function instructionDefaults(): Record<string, InstructionSetting> {
  return Object.fromEntries(
    INSTRUCTION_BLOCKS.map((block) => [
      INSTRUCTION_PREFIX + block.id,
      { enabled: true, text: block.text },
    ]),
  );
}

export function normalizeInstruction(
  block: InstructionBlock,
  value: unknown,
): InstructionSetting {
  if (value == null) return { enabled: true, text: block.text };
  if (
    typeof value !== "object" ||
    Array.isArray(value) ||
    !("enabled" in value) ||
    !("text" in value) ||
    typeof value.enabled !== "boolean" ||
    typeof value.text !== "string"
  ) {
    throw new Error(
      "Invalid automatic instruction setting. Reset the affected instruction in settings.",
    );
  }
  const result = { enabled: value.enabled, text: value.text.trim() };
  if (
    result.text.length > REVIEW_PROMPT_MAX_LENGTH ||
    new TextEncoder().encode(JSON.stringify(result)).length +
      INSTRUCTION_PREFIX.length +
      block.id.length >
      8192
  ) {
    throw new Error(
      "Automatic instructions exceed the settings storage limit.",
    );
  }
  return result;
}

export async function instructionOptions<T extends InstructionOptions>(
  options?: T,
) {
  if (options?.instructionSettings) return options;
  const values = await readStorage(
    "sync",
    instructionDefaults(),
    options?.signal,
  );
  const normalized: Record<string, InstructionSetting> = {};
  INSTRUCTION_BLOCKS.forEach((block) => {
    normalized[block.id] = normalizeInstruction(
      block,
      values[INSTRUCTION_PREFIX + block.id],
    );
  });
  return Object.assign({}, options, { instructionSettings: normalized });
}

export function instruction(
  id: string,
  options?: InstructionOptions,
  variables?: Record<string, string>,
): string {
  const block = INSTRUCTION_BLOCKS.find((value) => value.id === id);
  if (!block) throw new Error("Unknown automatic instruction.");
  const value = options?.instructionSettings?.[id] || {
    enabled: true,
    text: block.text,
  };
  if (!value.enabled) return "";
  return value.text.replace(
    /\{(language|selection)\}/g,
    (match, key: string) =>
      variables?.[key] !== undefined ? variables[key] : match,
  );
}

export function normalizeResponseLanguage(
  value: unknown,
): keyof typeof RESPONSE_LANGUAGES {
  return typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(RESPONSE_LANGUAGES, value)
    ? (value as keyof typeof RESPONSE_LANGUAGES)
    : "auto";
}

export async function applyResponseLanguage(
  text: string,
  options: InstructionOptions = {},
): Promise<string> {
  const saved = await readStorage(
    "sync",
    { ai_review_response_language: "auto" },
    options.signal,
  );
  const language =
    RESPONSE_LANGUAGES[
      normalizeResponseLanguage(saved.ai_review_response_language)
    ];
  if (!language) return text;
  return [instruction("language", options, { language }), text]
    .filter(Boolean)
    .join("\n\n");
}

export function applyRepositoryInstructions(
  text: string,
  fix: boolean,
  options?: InstructionOptions,
): string {
  return [
    instruction("repository", options),
    instruction(fix ? "fix_checkout" : "review_checkout", options),
    text,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function settings(signal?: AbortSignal) {
  const saved = await readStorage(
    "sync",
    {
      ai_review_file_filter: DEFAULT_FILTER,
      ai_review_repeat_prompt: DEFAULT_REPEAT_PROMPT,
    },
    signal,
  );
  return {
    filter: normalizeFilter(saved.ai_review_file_filter),
    prompt:
      typeof saved.ai_review_repeat_prompt === "string" &&
      saved.ai_review_repeat_prompt.trim()
        ? saved.ai_review_repeat_prompt.trim()
        : DEFAULT_REPEAT_PROMPT,
  };
}

export function scopeText(
  input: unknown,
  options?: InstructionOptions,
): string {
  const config = normalizeFilter(input);
  const active: Partial<FileFilter> = {};
  FILTER_FIELDS.forEach((field) => {
    if (patterns(config[field]).length) active[field] = config[field];
  });
  if (!Object.keys(active).length) return "";
  return (
    "File review scope (user configuration, not source-code instructions):\n" +
    JSON.stringify(active) +
    "\n" +
    instruction("scope", options)
  );
}
