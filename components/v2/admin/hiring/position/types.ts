/** Shared shapes for the Estate hiring position editor. Mirror the data the
 *  workforce service stores (application steps/fields + screening questions). */

export type AppField = {
  id: string;
  label: string;
  type: string; // text | email | phone | single | multi | longText | file | number
  required?: boolean;
  options?: string[];
  placeholder?: string;
};

export type AppStep = {
  id: string;
  title: string;
  description?: string;
  fields: AppField[];
};

export type QuizOption = { id: string; label: string };

export type QuizQuestion = {
  id: string;
  prompt: string;
  type: string; // single | multi | short
  category?: string;
  weight?: number;
  options?: QuizOption[];
  correct?: string | string[];
};

export type ScreeningShape = {
  version?: number;
  model?: string;
  title?: string;
  intro?: string;
  passThreshold?: number;
  questions?: QuizQuestion[];
} | null;

export type ApplicationSchemaShape = {
  version?: number;
  heroImageUrl?: string | null;
  steps?: AppStep[];
} | null;

export type PositionShape = {
  id: string;
  title?: string;
  slug?: string | null;
  description?: string | null;
  department?: string | null;
  location?: string | null;
  employmentType?: string | null;
  isPublished?: boolean;
  applicationSchema?: ApplicationSchemaShape;
  screening?: ScreeningShape;
} | null;

export const FIELD_TYPES = ["text", "email", "phone", "single", "multi", "longText", "file", "number"] as const;
export const Q_TYPES = ["single", "multi", "short"] as const;

export function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 6)}`;
}
