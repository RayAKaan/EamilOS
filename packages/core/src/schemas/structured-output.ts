import { z } from 'zod';

export const FileOutputSchema = z.object({
  filePath: z.string().min(1, 'filePath is required'),
  content: z.string(),
  language: z.string().optional(),
});

export type FileOutput = z.infer<typeof FileOutputSchema>;

export const StructuredOutputSchema = z.object({
  files: z.array(FileOutputSchema).min(1, 'At least one file is required'),
  explanation: z.string().optional(),
});

export type StructuredOutput = z.infer<typeof StructuredOutputSchema>;

export interface ParseResult {
  success: boolean;
  files: FileOutput[];
  error?: string;
  parseMethod: 'structured' | 'codeblock' | 'fallback' | 'none';
  rawContent?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  filePath: string;
  line?: number;
  column?: number;
  message: string;
  severity: 'error';
}

export interface ValidationWarning {
  filePath: string;
  line?: number;
  column?: number;
  message: string;
  severity: 'warning';
}
