/**
 * MIT License
 *
 * Copyright (c) 2023–Present PPResume (https://ppresume.com)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */

export type {
  AgentRunFailure,
  AgentRunStatus,
  AgentTraceEvent,
  CandidateInput,
  CandidateInputData,
  CandidateNormalizationResult,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  DraftResponse,
  Evidence,
  ExtractedArtifact,
  ExtractedArtifactKind,
  FollowUpQuestion,
  InputBundle,
  InputFile,
  InteractionAnswer,
  InteractionChoiceOption,
  InteractionConfirmControl,
  InteractionControl,
  InteractionDateControl,
  InteractionDateRangeControl,
  InteractionFileControl,
  InteractionFileReference,
  InteractionMultiChoiceControl,
  InteractionNumberControl,
  InteractionRequest,
  InteractionSingleChoiceControl,
  InteractionTextareaControl,
  InteractionTextControl,
  InteractionUrlControl,
  JobRequirement,
  JobSpec,
  JsonCompletionRequest,
  LlmClient,
  LlmImageAttachment,
  MatchReport,
  MatchStatus,
  QualityReport,
  QualityWarning,
  RenderedResume,
  RequirementMatch,
  ResumeAgentRun,
  ResumeChange,
  ResumeChangeType,
  ResumeDiff,
  ResumeTailoringCheckpoint,
  StructuredOutputTelemetry,
  TailorPreferences,
  TailorResumeRequest,
  TailorResumeRequestData,
  TailorResumeResult,
} from './contracts'
export {
  CandidateInputSchema,
  CandidateNormalizationResponseSchema,
  ChatMessageSchema,
  ChatRequestSchema,
  ChatResponseSchema,
  DraftResponseSchema,
  FollowUpQuestionSchema,
  InteractionAnswerSchema,
  InteractionChoiceOptionSchema,
  InteractionControlSchema,
  InteractionRequestSchema,
  JobRequirementSchema,
  JobSpecSchema,
  TailorPreferencesSchema,
  TailorResumeRequestSchema,
} from './contracts'
export type {
  EvalCampaignAggregate,
  EvalCampaignConfiguration,
  EvalCampaignConfigurationData,
  EvalCampaignReport,
} from './evaluation/campaign'
export {
  EvalCampaignConfigurationSchema,
  runEvaluationCampaign,
} from './evaluation/campaign'
export type {
  EvalAssertionCode,
  EvalAssertionResult,
  EvalCase,
  EvalCaseData,
  EvalCaseProvenance,
  EvalCaseResult,
  EvalDataset,
  EvalExecute,
  EvalExecutionResult,
  EvalExpectations,
  EvalFailureCode,
  EvalReport,
} from './evaluation/contracts'
export {
  EvalCaseProvenanceSchema,
  EvalCaseSchema,
  EvalDatasetSchema,
  EvalExecutionResultSchema,
  EvalExpectationsSchema,
} from './evaluation/contracts'
export { publicJobDerivedDevelopmentCases } from './evaluation/fixtures/public-job-derived'
export type {
  ResumeHumanReview,
  ResumeHumanReviewAgreementMetric,
  ResumeHumanReviewBatch,
  ResumeHumanReviewCaseVariantAggregate,
  ResumeHumanReviewDimension,
  ResumeHumanReviewIssueCode,
  ResumeHumanReviewPairwiseExactAgreement,
  ResumeHumanReviewRating,
  ResumeHumanReviewRatingCounts,
  ResumeHumanReviewRecommendation,
  ResumeHumanReviewRecommendationCounts,
  ResumeHumanReviewReport,
} from './evaluation/human-review'
export {
  RESUME_HUMAN_REVIEW_DIMENSIONS,
  RESUME_HUMAN_REVIEW_RUBRIC_REVISION,
  ResumeHumanReviewBatchSchema,
  ResumeHumanReviewIssueCodeSchema,
  ResumeHumanReviewRatingSchema,
  ResumeHumanReviewRecommendationSchema,
  ResumeHumanReviewSchema,
  resumeHumanReviewRubricV1,
  summarizeResumeHumanReviews,
} from './evaluation/human-review'
export { runEvaluation } from './evaluation/runner'
export type { ArtifactInputErrorCode } from './input/artifacts'
export {
  ArtifactInputError,
  extractArtifact,
  extractArtifacts,
} from './input/artifacts'
export { artifactEvidence, normalizeCandidateInput } from './input/candidate'
export { createOfflineLlmClient } from './llm/offline'
export type { OpenAICompatibleConfig } from './llm/openai-compatible'
export {
  createOpenAICompatibleClientFromEnv,
  LlmConfigurationError,
  LlmRequestError,
  OpenAICompatibleClient,
} from './llm/openai-compatible'
export type {
  StructuredOutputIssueSummary,
  StructuredOutputResult,
  StructuredOutputSpec,
} from './llm/structured-output'
export {
  completeStructuredOutput,
  StructuredOutputValidationError,
} from './llm/structured-output'
export {
  DefaultPdfCompiler,
  renderResumeVariant,
  resumeToDocx,
} from './rendering/artifacts'
export {
  applyStylePreset,
  getStylePreset,
  resolveStyleIDs,
  STYLE_PRESETS,
} from './rendering/styles'
export { buildResumeDiff } from './transparency/diff'
export { buildQualityReport } from './transparency/quality'
export { buildEvidenceIndex } from './validation/evidence'
export type { AgentValidationStage } from './validation/resume'
export {
  CandidateValidationError,
  DraftValidationError,
  parseCandidateResume,
  prepareDraftResume,
  validateNormalizationFacts,
} from './validation/resume'
export type { ResumeTailoringRunOptions } from './workflow/agent'
export { ResumeTailoringAgent } from './workflow/agent'
export {
  applyInteractionAnswer,
  createInteractionRequests,
  InteractionValidationError,
  validateInteractionAnswer,
} from './workflow/interaction'
export type {
  ClaimedRunTask,
  ClaimRunTaskOptions,
  DurableRunStore,
  ResumeAgentRunServiceOptions,
  RunAnswerErrorCode,
  RunStore,
  RunTask,
  RunTaskKind,
  StoredResumeAgentRun,
} from './workflow/run'
export {
  InMemoryRunStore,
  ResumeAgentRunService,
  RunAnswerError,
} from './workflow/run'
export type {
  RunStoreErrorCode,
  SqliteRunStoreOptions,
} from './workflow/sqlite-run-store'
export {
  RunStoreError,
  SqliteRunStore,
} from './workflow/sqlite-run-store'
