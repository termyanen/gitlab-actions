import {
  decoder,
  isNumber,
  isString,
  objectOf,
  optional,
} from "../../../shared/lib/validation";
import { type Job, type Pipeline } from "./types";
export const readPipeline = decoder(
  objectOf<Pipeline>({
    id: isNumber,
    project_id: optional(isNumber),
    sha: optional(isString),
    ref: optional(isString),
    status: optional(isString),
  }),
  "Pipeline response",
);
export const readJob = decoder(
  objectOf<Job>({
    id: isNumber,
    name: optional(isString),
    status: optional(isString),
    web_url: optional(isString),
    stage: optional(isString),
  }),
  "Job response",
);

// Mutating job endpoints may acknowledge success without returning job metadata.
export const readJobResult = decoder(
  objectOf<{ id?: number }>({ id: optional(isNumber) }),
  "job result",
);
