import { IssueSchema } from '../../src/models/schema';

// Generation constraints complement (never replace) the stricter local Zod and
// original-text validation. Keep this schema stable so servers can cache it.
export const feedbackJsonSchema = {
  type: 'object', additionalProperties: false,
  required: ['sentence_id', 'original_text', 'status', 'overall_explanation_zh', 'suggested_revision', 'issues', 'confidence'],
  properties: {
    sentence_id: { type: 'string', description: 'Copy the input sentence_id exactly.' },
    original_text: { type: 'string', description: 'Copy the input original_text exactly, including punctuation.' },
    status: { type: 'string', enum: ['good', 'needs_revision', 'incomplete', 'error'] },
    overall_explanation_zh: { type: 'string', description: '简短中文说明，必须包含中文，不能只写英文。' },
    suggested_revision: { type: ['string', 'null'], description: 'Corrected English sentence for needs_revision; otherwise null. Always null for document review.' },
    issues: {
      type: 'array', maxItems: 3,
      items: {
        type: 'object', additionalProperties: false,
        required: ['type', 'severity', 'original_span', 'suggested_text', 'explanation_zh'],
        properties: {
          type: { type: 'string', enum: IssueSchema.shape.type.options },
          severity: { type: 'string', enum: IssueSchema.shape.severity.options },
          original_span: { type: 'string', description: 'Exact nonempty substring of original_text.' },
          suggested_text: { type: 'string', description: 'English replacement, or empty string for deletion.' },
          explanation_zh: { type: 'string', description: '用中文解释此问题及修改理由。' }
        }
      }
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 }
  }
};
